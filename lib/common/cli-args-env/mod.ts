import { Command as CliffyCommand } from "jsr:@cliffy/command@^1";

interface CliOptionConfig {
  name: string;
  type: "string" | "number" | "flag";
  description: string;
  env?: string;
  default?: unknown;
}

interface CliArgsEnvConfig {
  name: string;
  description: string;
  options: CliOptionConfig[];
}

function buildCommand(
  argsEnv: CliArgsEnvConfig,
  runtimeConfig: Record<string, unknown> | null,
): CliffyCommand {
  let cmd: any = new CliffyCommand()
    .name(argsEnv.name)
    .description(argsEnv.description);

  for (const opt of argsEnv.options) {
    if (opt.type === "flag") {
      cmd = cmd.option(`--${opt.name}`, opt.description);
      continue;
    }

    const typeSuffix = opt.type === "number" ? ":number" : "";
    const envVal = opt.env ? Deno.env.get(opt.env) : undefined;
    const configVal = runtimeConfig?.[opt.name];
    const hasDefault = "default" in opt;

    if (hasDefault) {
      const def = envVal ?? configVal ?? opt.default;
      cmd = cmd.option(
        `--${opt.name} <val${typeSuffix}>`,
        opt.description,
        { default: opt.type === "number" ? Number(def) : def },
      );
    } else if (envVal !== undefined) {
      cmd = cmd.option(
        `--${opt.name} <val${typeSuffix}>`,
        opt.description,
        { default: opt.type === "number" ? Number(envVal) : envVal },
      );
    } else if (configVal !== undefined) {
      cmd = cmd.option(
        `--${opt.name} <val${typeSuffix}>`,
        opt.description,
        { default: opt.type === "number" ? Number(configVal) : configVal },
      );
    } else {
      cmd = cmd.option(
        `--${opt.name} <val${typeSuffix}>`,
        opt.description,
      );
    }
  }

  return cmd as CliffyCommand;
}

async function loadConfig(configPathEnv: string) {
  const argsEnvPath = new URL("./cli-args-env.json", Deno.mainModule).pathname;
  const argsEnv: CliArgsEnvConfig = JSON.parse(
    await Deno.readTextFile(argsEnvPath),
  );

  const runtimePath = Deno.env.get(configPathEnv) ??
    new URL("./config.json", Deno.mainModule).pathname;

  let runtimeConfig: Record<string, unknown> | null = null;
  try {
    runtimeConfig = JSON.parse(await Deno.readTextFile(runtimePath));
  } catch { }

  return { argsEnv, runtimeConfig };
}

type CommandResult = { options: Record<string, any>; args: string[]; cmd: CliffyCommand };

class CommandImpl {
  constructor(configPathEnv: string) {
    return loadConfig(configPathEnv)
      .then(({ argsEnv, runtimeConfig }) => buildCommand(argsEnv, runtimeConfig))
      .then((cmd) => cmd.parse(Deno.args)) as unknown as CommandImpl;
  }
}

const Command = CommandImpl as unknown as {
  new(configPathEnv: string): Promise<CommandResult>;
};

export { Command };
