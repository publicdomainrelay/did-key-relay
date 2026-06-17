import { createStructuredLogger } from "@publicdomainrelay/logger";
import {
  hostnameOnly,
  didToSubdomain,
  SUBSCRIBE_NSID,
  GET_NONCE_NSID,
  summarizeFrame,
} from "@publicdomainrelay/did-key-relay-common";
import type {
  SubscriberOptions,
  SubscriberHandle,
  CallerOptions,
  CallerHandle,
} from "@publicdomainrelay/did-key-relay-subscriber-abc";
import type { RelayRequest } from "@publicdomainrelay/did-key-relay-common";
const log = createStructuredLogger("subscriber");

export interface RelayRequestResult {
  status: number;
  body: unknown;
  contentType: string;
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function httpOrigin(host: string): string {
  if (host.includes(":") || host === "localhost") return `http://${host}`;
  return `https://${host}`;
}

function wsOrigin(host: string): string {
  if (host.includes(":") || host === "localhost") return `ws://${host}`;
  return `wss://${host}`;
}

export async function createSubscriber(
  opts: SubscriberOptions,
): Promise<SubscriberHandle> {
  const label = opts.label ?? "subscriber";
  const did = opts.keypair.did();
  const subdomain = didToSubdomain(did);
  const hostname = hostnameOnly(opts.dispatcherHost);
  const proxyRef = `did:web:${subdomain}.${hostname}`;

  const nonceToken = await opts.getServiceAuthToken(GET_NONCE_NSID);
  const nonceRes = await fetch(`${httpOrigin(opts.dispatcherHost)}/xrpc/${GET_NONCE_NSID}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${nonceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key: did, signatures: [] }),
  });
  if (!nonceRes.ok) {
    const err = await nonceRes.text();
    throw new Error(`nonce request failed: ${nonceRes.status} ${err}`);
  }
  const { nonce } = await nonceRes.json() as { nonce: string };

  const sig = await opts.keypair.sign(decodeBase64(nonce));

  const registration = JSON.stringify({
    $type: "com.fedproxy.temp.xrpc.registration",
    key: did,
    nonce,
    signatures: [{ key: did, signature: encodeBase64(sig) }],
  });

  const subscribeToken = await opts.getServiceAuthToken(SUBSCRIBE_NSID);

  const wsUrl = `${wsOrigin(opts.dispatcherHost)}/xrpc/${SUBSCRIBE_NSID}?registration=${
    encodeURIComponent(registration)
  }&did=${encodeURIComponent(did)}&service_auth=${encodeURIComponent(subscribeToken)}`;

  const ws = new WebSocket(wsUrl);
  const registeredPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("registration timeout")),
      30_000,
    );
    ws.onopen = () => {
      log.info("ws_open", { component: label, host: opts.dispatcherHost });
    };
    ws.onmessage = (evt) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data as string) as Record<string, unknown>;
      } catch {
        return;
      }
      const $type = msg.$type as string | undefined;
      if ($type === `${SUBSCRIBE_NSID}#registered`) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (!$type?.startsWith(`${SUBSCRIBE_NSID}#`)) return;
      const kind = $type.slice($type.indexOf("#") + 1);
      switch (kind) {
        case "request": {
          if (opts.handleRequest) {
            const req: RelayRequest = {
              requestId: msg.requestId as string,
              method: msg.method as string,
              path: msg.path as string,
              params: (msg.params as Record<string, string>) ?? {},
              body: msg.body,
              headers: (msg.headers as Record<string, string>) ?? {},
            };
            opts.handleRequest(req).then(
              (result) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    $type: `${SUBSCRIBE_NSID}#response`,
                    requestId: msg.requestId,
                    status: result.status,
                    body: result.body,
                    contentType: result.contentType,
                  }));
                }
              },
              (err) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    $type: `${SUBSCRIBE_NSID}#response`,
                    requestId: msg.requestId,
                    status: 500,
                    body: { error: "InternalError", message: String(err) },
                    contentType: "application/json",
                  }));
                }
              },
            );
          }
          break;
        }
        case "subscribe": {
          if (opts.synthetic) {
            const subscriptionId = msg.subscriptionId as string;
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                $type: `${SUBSCRIBE_NSID}#subscriptionOpen`,
                subscriptionId,
              }));
            }
            let seq = 0;
            const interval = setInterval(() => {
              if (ws.readyState !== WebSocket.OPEN) {
                clearInterval(interval);
                return;
              }
              ws.send(JSON.stringify({
                $type: `${SUBSCRIBE_NSID}#subscriptionEvent`,
                subscriptionId,
                message: {
                  seq: seq++,
                  time: new Date().toISOString(),
                  event: "synthetic",
                },
              }));
            }, 5000);
            const origOnClose = ws.onclose;
            ws.onclose = (evt) => {
              clearInterval(interval);
              origOnClose?.call(ws, evt);
            };
          }
          break;
        }
        case "subscriptionCancel": {
          break;
        }
      }
    };
    ws.onerror = (evt) => {
      log.error("ws_error", { component: label, error: String(evt) });
      clearTimeout(timeout);
      reject(new Error("WebSocket error during registration"));
    };
    ws.onclose = (evt) => {
      log.info("ws_close", { component: label, code: evt.code, reason: evt.reason });
    };
  });

  await registeredPromise;
  return { subdomain, proxyRef, ws };
}

export function createCaller(opts: CallerOptions): CallerHandle {
  const label = opts.label ?? "caller";
  const nsid = opts.nsid ?? "com.atproto.sync.subscribeRepos";
  const subdomain = opts.subscriberSubdomain ??
    (opts.subscriberDid ? didToSubdomain(opts.subscriberDid) : undefined);

  if (!subdomain) {
    throw new Error("subscriberDid or subscriberSubdomain required");
  }

  const hostname = hostnameOnly(opts.dispatcherHost);
  const url = new URL(
    `wss://${subdomain}.${opts.dispatcherHost}/xrpc/${nsid}`,
  );
  if (opts.cursor !== undefined) {
    url.searchParams.set("cursor", String(opts.cursor));
  }

  let eventIndex = 0;
  let closed = false;

  function connect(): WebSocket {
    const ws = new WebSocket(url);
    ws.onopen = () => {
      log.info("ws_open", { component: label, url: url.toString() });
    };
    ws.onmessage = (evt) => {
      let msg: unknown;
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        msg = evt.data;
      }
      const summary = summarizeFrame(msg);
      opts.onEvent?.(summary, eventIndex++);
    };
    ws.onerror = () => {
      log.error("ws_error", { component: label });
    };
    ws.onclose = (evt) => {
      log.info("ws_close", { component: label, code: evt.code, reason: evt.reason });
      if (!closed) {
        setTimeout(() => {
          if (!closed) connect();
        }, 5_000);
      }
    };
    return ws;
  }

  const ws = connect();

  return {
    close() {
      closed = true;
      ws.close();
    },
  };
}
