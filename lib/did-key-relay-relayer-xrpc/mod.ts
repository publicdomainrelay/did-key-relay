import type { NonceStore, VerifyResult } from "@publicdomainrelay/did-key-relay-relayer-abc";

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

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadB64 = token.split(".")[1];
  if (!payloadB64) throw new Error("malformed JWT");
  const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}

export function verifyServiceAuth(
  authHeader: string | null | undefined,
  audDid: string,
  lxm: string,
  _serviceAuth?: string,
): void {
  if (!authHeader) {
    throw new Error("missing Authorization header");
  }
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    throw new Error("Authorization header must be Bearer <token>");
  }
  const token = parts[1];
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwtPayload(token);
  } catch {
    throw new Error("failed to decode service auth JWT");
  }
  if (payload.aud !== audDid) {
    throw new Error(
      `aud mismatch: expected ${audDid}, got ${payload.aud}`,
    );
  }
  if (payload.lxm !== lxm) {
    throw new Error(`lxm mismatch: expected ${lxm}, got ${payload.lxm}`);
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    throw new Error("service auth token expired");
  }
}

export interface VerifyServiceAuthOptions {
  authHeader: string | null | undefined;
  hostname: string;
  lxm: string;
  serviceIds?: string[];
  idResolver?: unknown;
}

export interface VerifyServiceAuthResult {
  issuerDid: string;
}

export async function verifyServiceAuthExt(
  opts: VerifyServiceAuthOptions,
): Promise<VerifyServiceAuthResult> {
  if (!opts.authHeader) {
    throw new Error("missing Authorization header");
  }
  const parts = opts.authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    throw new Error("Authorization header must be Bearer <token>");
  }
  const token = parts[1];

  let payload: Record<string, unknown>;
  try {
    payload = decodeJwtPayload(token);
  } catch {
    throw new Error("failed to decode service auth JWT");
  }

  const audDid = `did:web:${opts.hostname}`;
  if (payload.aud !== audDid) {
    throw new Error(`aud mismatch: expected ${audDid}, got ${payload.aud}`);
  }

  if (payload.lxm !== opts.lxm) {
    throw new Error(`lxm mismatch: expected ${opts.lxm}, got ${payload.lxm}`);
  }

  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    throw new Error("service auth token expired");
  }

  const issuerDid = payload.iss as string;
  if (!issuerDid?.startsWith("did:")) {
    throw new Error("invalid issuer DID in service auth token");
  }

  return { issuerDid };
}
