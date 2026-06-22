import { Command } from "@publicdomainrelay/cli-args-env";
import { createLogger } from "@publicdomainrelay/logger";
import { createServe } from "@publicdomainrelay/serve";
import { createRelayFactory } from "@publicdomainrelay/hono-factory-did-key-relay-relayer-xrpc";
import cliArgsEnv from "./cli-args-env.json" with { type: "json" };

const logger = createLogger({ serviceName: "relay" });

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

const unixSocket = options.unixSocket as string | undefined;
const serve = createServe({
  logger,
  unix: unixSocket ? { socketPath: unixSocket } : undefined,
  tcp: unixSocket ? undefined : { port: options.port as number },
});
serve.app.route("/", app as never);

function shutdown() {
  serve.shutdown();
  Deno.exit();
}
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

await serve.beginServe();
