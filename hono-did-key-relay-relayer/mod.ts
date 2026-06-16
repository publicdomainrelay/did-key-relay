import { Command } from "@publicdomainrelay/cli-args-env";
import { log } from "@publicdomainrelay/did-key-relay-common";
import { createRelayFactory } from "@publicdomainrelay/hono-factory-did-key-relay-relayer-xrpc";

const { options } = await new Command("CONFIG_PATH_HONO_DID_KEY_RELAY_RELAYER");

const app = createRelayFactory({
  hostname: options.hostname,
  serviceId: options.serviceId,
  relayTimeoutMs: options.relayTimeoutMs,
  reconnectGraceMs: options.reconnectGraceMs,
  nonceTtlMs: options.nonceTtlMs,
}).createApp();

if (options.unixSocket) {
  try { Deno.removeSync(options.unixSocket); } catch { }
  Deno.serve({ path: options.unixSocket, onListen: (localAddr) => log("info", { component: "relay", event: "listening", localAddr: localAddr.path }) }, app.fetch);
} else {
  Deno.serve({ port: options.port, onListen: (localAddr) => log("info", { component: "relay", event: "listening", localAddr: localAddr.hostname, port: localAddr.port }) }, app.fetch);
}
