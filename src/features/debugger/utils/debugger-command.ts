import type {
  DebuggableFile,
  DebugLaunchConfig,
  DebuggerRuntime,
} from "@/features/debugger/types/debugger";
import { getBaseName, getDirName } from "@/utils/path-helpers";

const JS_EXTENSIONS = new Set(["js", "cjs", "mjs", "jsx", "ts", "tsx"]);

const getExtension = (path: string) => {
  const match = path.toLowerCase().match(/\.([^.\\/]+)$/);
  return match?.[1] ?? "";
};

const quoteShellArg = (value: string) => {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const joinCommand = (parts: Array<string | undefined>) =>
  parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map(quoteShellArg)
    .join(" ");

export function inferDebuggerRuntime(file?: DebuggableFile | null): DebuggerRuntime {
  if (!file?.path) return "custom";

  const extension = getExtension(file.path);
  if (JS_EXTENSIONS.has(extension)) return "bun";
  if (extension === "py") return "python";
  if (extension === "rs" || file.name === "Cargo.toml") return "rust";
  if (extension === "go") return "go";

  return "custom";
}

export function createGeneratedDebugConfig(
  file: DebuggableFile | null,
  workspaceRoot?: string | null,
): DebugLaunchConfig {
  const runtime = inferDebuggerRuntime(file);
  const cwd = workspaceRoot ?? undefined;

  if (!file?.path || runtime === "custom") {
    return {
      id: "generated-custom",
      name: "Custom debug command",
      runtime: "custom",
      cwd,
      command: "",
      source: "generated",
    };
  }

  return {
    id: `generated-${runtime}`,
    name: `Debug ${file.name}`,
    runtime,
    cwd,
    program: file.path,
    source: "generated",
  };
}

export function buildDebugCommand(config: DebugLaunchConfig): string {
  const args = config.args ?? [];

  switch (config.runtime) {
    case "bun":
      return joinCommand(["bun", "--inspect-brk", config.program, ...args]);
    case "node":
      return joinCommand(["node", "--inspect-brk", config.program, ...args]);
    case "python":
      return joinCommand(["python", "-m", "pdb", config.program, ...args]);
    case "rust":
      return joinCommand(["cargo", "run", ...args]);
    case "go":
      return joinCommand(["dlv", "debug", config.program, "--", ...args]);
    case "custom":
      return config.command?.trim() ?? "";
  }
}

export function resolveDebugConfigVariables(
  config: DebugLaunchConfig,
  file?: DebuggableFile | null,
  workspaceRoot?: string | null,
): DebugLaunchConfig {
  const resolveValue = (value: string) =>
    value
      .replace(/\$\{workspaceFolder\}/g, workspaceRoot ?? "")
      .replace(/\$\{file\}/g, file?.path ?? "")
      .replace(/\$\{fileBasename\}/g, file?.path ? getBaseName(file.path) : "")
      .replace(/\$\{fileDirname\}/g, file?.path ? getDirName(file.path) : "");

  return {
    ...config,
    program: config.program ? resolveValue(config.program) : config.program,
    cwd: config.cwd ? resolveValue(config.cwd) : config.cwd,
    command: config.command ? resolveValue(config.command) : config.command,
    args: config.args?.map(resolveValue),
    adapterCommand: config.adapterCommand
      ? resolveValue(config.adapterCommand)
      : config.adapterCommand,
    adapterArgs: config.adapterArgs?.map(resolveValue),
    env: config.env
      ? Object.fromEntries(
          Object.entries(config.env).map(([key, value]) => [key, resolveValue(value)]),
        )
      : config.env,
  };
}

export function normalizeLaunchConfigs(raw: unknown): DebugLaunchConfig[] {
  if (!raw || typeof raw !== "object") return [];

  const container = raw as { configurations?: unknown };
  if (!Array.isArray(container.configurations)) return [];

  return container.configurations
    .map((candidate, index): DebugLaunchConfig | null => {
      if (!candidate || typeof candidate !== "object") return null;

      const config = candidate as Record<string, unknown>;
      const name = typeof config.name === "string" ? config.name.trim() : "";
      if (!name) return null;

      const runtime =
        typeof config.runtime === "string"
          ? normalizeRuntime(config.runtime)
          : typeof config.type === "string"
            ? normalizeRuntime(config.type)
            : "custom";

      const program = typeof config.program === "string" ? config.program : undefined;
      const cwd = typeof config.cwd === "string" ? config.cwd : undefined;
      const command = typeof config.command === "string" ? config.command : undefined;
      const adapterCommand =
        typeof config.adapterCommand === "string" ? config.adapterCommand : undefined;
      const args = Array.isArray(config.args)
        ? config.args.filter((arg): arg is string => typeof arg === "string")
        : undefined;
      const adapterArgs = Array.isArray(config.adapterArgs)
        ? config.adapterArgs.filter((arg): arg is string => typeof arg === "string")
        : undefined;
      const request = config.request === "attach" ? "attach" : "launch";
      const type = typeof config.type === "string" ? config.type : undefined;

      return {
        id: `workspace-${index}-${name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`,
        name,
        runtime,
        type,
        request,
        program,
        cwd,
        command,
        args,
        adapterCommand,
        adapterArgs,
        source: "workspace",
      };
    })
    .filter((config): config is DebugLaunchConfig => Boolean(config));
}

export function parseDebugLaunchJson(content: string): DebugLaunchConfig[] {
  return normalizeLaunchConfigs(JSON.parse(stripJsonComments(content)));
}

function normalizeRuntime(value: string): DebuggerRuntime {
  const normalized = value.toLowerCase();
  if (normalized.includes("bun")) return "bun";
  if (normalized.includes("node") || normalized.includes("pwa-node")) return "node";
  if (normalized.includes("python") || normalized.includes("debugpy")) return "python";
  if (normalized.includes("rust") || normalized.includes("lldb")) return "rust";
  if (normalized.includes("go") || normalized.includes("delve")) return "go";
  return "custom";
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/g, "$1"))
    .join("\n");
}
