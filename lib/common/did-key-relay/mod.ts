export const SUBSCRIBE_NSID = "com.example.dispatcher.subscribe";
export const GET_NONCE_NSID = "com.example.dispatcher.register";

export const DEFAULT_MARKET_SERVICE_ID = "pdr_temp_market";

export function log(
  level: "debug" | "info" | "warn" | "error",
  data: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...data,
  });
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

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
