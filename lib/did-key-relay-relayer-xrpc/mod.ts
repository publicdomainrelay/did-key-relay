import type { NonceStore, VerifyResult } from "@publicdomainrelay/did-key-relay-relayer-abc";
import { decodeJwtPayload } from "@publicdomainrelay/did-key-relay-common";
export { verifyServiceAuth, verifyServiceAuthExt } from "@publicdomainrelay/did-key-relay-common";
export type { VerifyServiceAuthOptions, VerifyServiceAuthResult } from "@publicdomainrelay/did-key-relay-common";

interface NonceEntry {
  key: string;
  nonce: string;
  expiresAt: number;
}

export function createNonceStore(ttlMs: number): NonceStore {
  const entries = new Map<string, NonceEntry>();

  const purgeInterval = setInterval(() => {
    const now = Date.now();
    for (const [nonce, entry] of entries) {
      if (entry.expiresAt < now) entries.delete(nonce);
    }
  }, Math.min(ttlMs, 30_000));

  Deno.unrefTimer?.(purgeInterval);

  function generateNonce(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  return {
    issue(key: string): string {
      const nonce = generateNonce();
      entries.set(nonce, {
        key,
        nonce,
        expiresAt: Date.now() + ttlMs,
      });
      return nonce;
    },

    async verify(reg): Promise<VerifyResult> {
      if (!reg || typeof reg !== "object") {
        return { ok: false, reason: "invalid registration" };
      }
      if (!reg.key || typeof reg.key !== "string") {
        return { ok: false, reason: "missing key" };
      }
      if (!reg.nonce || typeof reg.nonce !== "string") {
        return { ok: false, reason: "missing nonce" };
      }
      const entry = entries.get(reg.nonce);
      if (!entry) {
        return { ok: false, reason: "unknown or expired nonce" };
      }
      if (entry.key !== reg.key) {
        return { ok: false, reason: "nonce was issued for a different key" };
      }
      if (entry.expiresAt < Date.now()) {
        entries.delete(reg.nonce);
        return { ok: false, reason: "nonce expired" };
      }
      const sigs = Array.isArray(reg.signatures) ? reg.signatures : [];
      if (sigs.length === 0) {
        return { ok: false, reason: "no signatures provided" };
      }
      entries.delete(reg.nonce);
      return { ok: true, key: reg.key };
    },
  };
}
