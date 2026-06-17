export const SUBSCRIBE_NSID = "com.publicdomainrelay.dispatcher.subscribe";
export const GET_NONCE_NSID = "com.publicdomainrelay.dispatcher.register";

export const DEFAULT_MARKET_SERVICE_ID = "pdr_temp_market";

export function hostnameOnly(host: string): string {
  let h = host;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end !== -1) h = h.slice(1, end);
  }
  const portIdx = h.lastIndexOf(":");
  if (portIdx !== -1 && portIdx > (h.startsWith("[") ? h.indexOf("]") : 0)) {
    h = h.slice(0, portIdx);
  }
  return h;
}

export function hostnameToDid(hostname: string): string {
  return `did:web:${hostnameOnly(hostname)}`;
}

export function didToSubdomain(did: string): string {
  return did.replaceAll(":", "-").toLowerCase();
}

export interface RelayRequestFrame {
  requestId: string;
  method: string;
  path: string;
  params: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export interface RelayResponse {
  status: number;
  body: unknown;
  contentType?: string;
}

export interface RelayRequest {
  requestId: string;
  method: string;
  path: string;
  params: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

export function inferFrameType(frame: unknown): string {
  if (typeof frame === "object" && frame !== null) {
    const rec = frame as Record<string, unknown>;
    return (rec.$type ?? rec._type ?? "unknown") as string;
  }
  return "unknown";
}

export function summarizeFrame(frame: unknown): Record<string, unknown> {
  if (typeof frame !== "object" || frame === null) {
    return { _type: "unknown", raw: String(frame) };
  }
  const rec = frame as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    _type: inferFrameType(frame),
  };
  for (const k of ["seq", "event", "time", "did", "operation", "commit"]) {
    if (k in rec) summary[k] = rec[k];
  }
  return summary;
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
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
