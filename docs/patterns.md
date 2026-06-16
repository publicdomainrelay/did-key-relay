# Patterns

Project structure. Library hierarchies. CLI config. Code layout rules.

## Directory Map

```
.
|-- deno.json                    # root workspace, nodeModulesDir, imports
|-- deno.lock
|-- lib/
|   |-- common/                  # shared code, zero or minimal deps
|   |   |-- did-key-relay/       # types, constants, utilities
|   |   \-- cli-args-env/        # cliffy wrapper, config loader
|   |-- abc/                     # abstract base classes / interfaces
|   |   |-- did-key-relay-relayer/
|   |   \-- did-key-relay-subscriber/
|   |-- did-key-relay-relayer-xrpc/       # concrete: xrpc relayer
|   |-- did-key-relay-subscriber-xrpc/    # concrete: xrpc subscriber
|   |-- hono-factory-did-key-relay-relayer-xrpc/     # final Hono wrapper
|   \-- hono-factory-did-key-relay-subscriber-xrpc/  # final Hono wrapper
|-- hono-did-key-relay-relayer/       # CLI: relay server
|-- hono-did-key-relay-subscriber/    # CLI: subscriber client
\-- lexicons/                         # AT Protocol lexicon schemas
```

## ABC Pattern - `lib/abc/`

Each "concept" gets three layers:

```
lib/abc/${concept}                  interface + abstract base
lib/${concept}-${transport}         concrete implementation
lib/hono-factory-${concept}-${transport}  final Hono factory, no further abstraction
hono-${concept}                     CLI entry point
```

### Layer 1: ABC (`lib/abc/`)

Pure interfaces. Pure types. Pure state (no I/O, no timers, no network).

- **Exports interfaces** - `NonceStore`, `SubscriberHandle`, `CallerHandle`
- **Exports concrete state classes** if zero I/O - `RelayState` (Maps + Promises, no side effects)
- **Depends only on** `lib/common/` packages (`type` imports for wire formats)
- **Never** imports transport-specific code
- **Never** has side effects

### Layer 2: Implementation (`lib/${concept}-${transport}/`)

Concrete transport binding. Timers, crypto, fetch, WebSocket.

- **Implements ABC interfaces** - `createNonceStore` satisfies `NonceStore`
- **Uses** `Deno.*` APIs, `crypto`, `setInterval`, `fetch`, `WebSocket`
- **Depends on** `lib/abc/` (types) + `lib/common/` (utilities)
- **Named** `${concept}-${transport}` - e.g. `did-key-relay-relayer-xrpc`
- **New transports** add sibling packages: `did-key-relay-relayer-grpc`, etc.

### Layer 3: Hono Factory (`lib/hono-factory-${concept}-${transport}/`)

Final, non-extensible Hono integration. No further subclasses.

- **Wraps** transport implementation in Hono routes
- **Exports** `createXxxFactory(opts)` -> returns Hono `Factory` with `.createApp()`
- **Depends on** transport impl + ABC + common
- **Never** subclassed or extended - composition, not inheritance

### Layer 4: CLI (`hono-${concept}/`)

Thin entry point. Reads config, builds factory, starts server.

- **Imports** `Command` from `@publicdomainrelay/cli-args-env`
- **Await `new Command("CONFIG_PATH_${NAME}")`** -> gets parsed `{ options }`
- **Wires** options into factory, calls `.createApp()`, `Deno.serve()`
- **No** option definitions in code - all in `cli-args-env.json`

## Package Rules

Every package under `lib/`:

```json
{
  "name": "@publicdomainrelay/${package-name}",
  "version": "0.0.0",
  "license": "Unlicense",
  "exports": "./mod.ts"
}
```

- **Single export** - `./mod.ts`, no sub-modules
- **Workspace member** - listed in root `deno.json` `workspace[]`
- **Imports use `jsr:` scope** - `"@publicdomainrelay/other-pkg": "jsr:@publicdomainrelay/other-pkg@^0"`
- **CLI packages** omit `name` field (entry points, not importable libraries)

## Dependency Direction

```
lib/common/*              <- zero deps (except external: hono, cliffy)
    ^
lib/abc/*                 <- depends on lib/common/ (type imports only)
    ^
lib/${impl}/*             <- depends on lib/abc/ + lib/common/
    ^
lib/hono-factory-*        <- depends on lib/${impl}/ + lib/abc/ + lib/common/ + hono
    ^
hono-* (CLI)              <- depends on hono-factory + common + external deps
```

No circular deps. No `lib/abc/` importing `lib/${impl}/`. No `lib/common/` importing anything project-local.

## CLI Config Pattern

Two JSON files per CLI:

### `cli-args-env.json` - Option Definitions

```json
{
  "name": "hono-did-key-relay-relayer",
  "description": "XRPC relay server",
  "options": [
    {
      "name": "hostname",
      "type": "string",
      "description": "Server hostname for DID doc and proxy refs",
      "env": "HOSTNAME",
      "default": "xrpc.fedproxy.com"
    },
    {
      "name": "port",
      "type": "number",
      "description": "TCP port to listen on",
      "env": "PORT",
      "default": 8080
    },
    {
      "name": "save-keypair",
      "type": "flag",
      "description": "Persist generated keypair to disk"
    },
    {
      "name": "keypair-path",
      "type": "string",
      "description": "Path to keypair file"
    }
  ]
}
```

- **Option types:** `string`, `number`, `flag`
- **`env`** - env var name for override (optional)
- **`default`** - ultimate fallback (optional; omit for no-default pattern)
- **`flag`** - boolean, no value, no `env`, no `default`
- **Keys are kebab-case** - matches `--flag-name` on CLI
- **Always module-relative** - resolved via `Deno.mainModule`, never overridden
- **Ships with package** - defines what the CLI accepts

### `config.json` - Deployment Values

```json
{
  "hostname": "xrpc.fedproxy.com",
  "port": 8080,
  "service-id": "xrpc_relay"
}
```

- **Flat key->value** - keys match option names (kebab-case)
- **Module-relative by default** - resolved via `Deno.mainModule`
- **Override via env var** - `CONFIG_PATH_HONO_DID_KEY_RELAY_RELAYER=/path/to/prod.json`
- **Optional** - CLI works without it (falls through to `cli-args-env.json` defaults)
- **Deployment swap** - same binary, different config per environment

### Priority Chain

```
CLI flag -> env var (per-option) -> config.json -> cli-args-env.json default
```

### `deno.json` for CLIs

```json
{
  "compile": {
    "include": ["cli-args-env.json", "config.json"]
  }
}
```

Both files bundled into VFS for `deno compile`. At runtime, `Deno.mainModule`-relative resolution finds them in VFS.

### `CONFIG_PATH_${NAME}` Env Var

- `${NAME}` = directory name, hyphens->underscores, UPPERCASE
- `hono-did-key-relay-relayer` -> `CONFIG_PATH_HONO_DID_KEY_RELAY_RELAYER`
- `hono-did-key-relay-subscriber` -> `CONFIG_PATH_HONO_DID_KEY_RELAY_SUBSCRIBER`
- Points to replacement `config.json` (not `cli-args-env.json`)
- If unset, `config.json` resolved relative to `Deno.mainModule`

## CLI Code Pattern

```ts
import { Command } from "@publicdomainrelay/cli-args-env";

const { options } = await new Command("CONFIG_PATH_HONO_DID_KEY_RELAY_RELAYER");

// options fully resolved via priority chain
// Use directly - no parsing, no env reading, no config loading
const app = createRelayFactory({
  hostname: options.hostname,
  port: options.port,
}).createApp();

Deno.serve({ port: options.port }, app.fetch);
```

- **One `new Command(...)` call** - all args/env/config handled
- **`options` typed as `Record<string, any>`** - trust runtime, TS can't track JSON-driven types
- **No `Deno.env.get()` in CLI code** - all env resolution in library
- **No `Deno.readTextFile()` for config** - library handles it
- **Keypair path pattern** - `options.keypairPath ?? "./keypair.json"` for explicit-vs-implicit

## `deno compile` and JSR

| Execution | Config Resolution |
|-----------|------------------|
| `deno run -A ./mod.ts` | `Deno.mainModule`-relative (any CWD) |
| `deno run -A jsr:@scope/pkg` | Cached package path (JSR downloads to cache) |
| `deno compile` binary | VFS via `compile.include` bundling |
| `CONFIG_PATH_*=...` set | Env var path (overrides all above) |

Key: `Deno.mainModule` always points to the entry module, whether local file, cached JSR package, or VFS in compiled binary. `new URL("./file.json", Deno.mainModule).pathname` resolves module-adjacent in all modes.

## Adding New Concept

To add a new ABC concept (e.g., `auth`):

```
lib/abc/auth/
    deno.json    @publicdomainrelay/auth-abc
    mod.ts       AuthVerifier interface
lib/auth-oauth/
    deno.json    @publicdomainrelay/auth-oauth
    mod.ts       OAuth implementation
lib/auth-atproto/
    deno.json    @publicdomainrelay/auth-atproto
    mod.ts       AT Protocol implementation
lib/hono-factory-auth-oauth/
    deno.json    @publicdomainrelay/hono-factory-auth-oauth
    mod.ts       Hono middleware wrapping OAuth
lib/hono-factory-auth-atproto/
    deno.json    @publicdomainrelay/hono-factory-auth-atproto
    mod.ts       Hono middleware wrapping AT Protocol
hono-relay/      <- updated to accept --with-auth=oauth|atproto
```

Root `deno.json` workspace grows with each new package.

## Anti-Patterns

- **No hardcoded defaults in CLI code** - use `cli-args-env.json` + `config.json`
- **No `Deno.env.get()` in CLI code** - env resolution in `cli-args-env` library, per-option `env` field
- **No sub-module exports** - one `mod.ts` per package
- **No cross-abc imports** - `relayer` and `subscriber` ABCs are independent
- **No I/O in `lib/abc/`** - interfaces + pure state only
- **No `lib/abc/` importing `lib/${impl}/`** - inversion
- **No comments** - never put comments in the code
- **No non-ASCII characters** - unless a functional implementation requirement, aka specially being asked to write code which handles emojis or something like that
