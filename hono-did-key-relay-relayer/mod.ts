import { Command } from "@publicdomainrelay/cli-args-env";
import { createStructuredLogger } from "@publicdomainrelay/logger";
import { createRelayFactory } from "@publicdomainrelay/hono-factory-did-key-relay-relayer-xrpc";
import cliArgsEnv from "./cli-args-env.json" with { type: "json" };

const log = createStructuredLogger("relay");

let runtimeConfig = null;
try {
  const mod = await import("./config.json", { with: { type: "json" } });
  runtimeConfig = mod.default;
} catch { /* optional */ }

const { options } = await new Command(
  "CONFIG_PATH_HONO_DID_KEY_RELAY_RELAYER",
  cliArgsEnv,
  runtimeConfig,
).resolve();

const app = createRelayFactory({
  hostname: options.hostname as string,
  serviceId: options.serviceId as string | undefined,
  relayTimeoutMs: options.relayTimeoutMs as number | undefined,
  reconnectGraceMs: options.reconnectGraceMs as number | undefined,
  nonceTtlMs: options.nonceTtlMs as number | undefined,
}).createApp();

if (options.unixSocket) {
  const socketPath = options.unixSocket as string;
  try { Deno.removeSync(socketPath); } catch { /* may not exist */ }
  Deno.serve({ path: socketPath, onListen: (localAddr) => log.info("listening", { component: "relay", localAddr: (localAddr as Deno.UnixAddr).path }) }, app.fetch);
} else {
  const port = options.port as number;
  Deno.serve({ port, onListen: (localAddr) => log.info("listening", { component: "relay", localAddr: (localAddr as Deno.NetAddr).hostname, port: (localAddr as Deno.NetAddr).port }) }, app.fetch);
}
