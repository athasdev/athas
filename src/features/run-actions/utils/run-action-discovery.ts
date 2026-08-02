import { invoke } from "@tauri-apps/api/core";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { joinPath } from "@/utils/path-helpers";
import type { CodeLensItem } from "@/features/editor/lsp/use-code-lens";
import type { RunActionItem, RunActionSource } from "../types/run-action.types";

type ManifestContents = Map<string, string>;

const SCRIPT_PRIORITY = new Map([
  ["dev", 0],
  ["start", 1],
  ["test", 2],
  ["check", 3],
  ["typecheck", 4],
  ["lint", 5],
  ["build", 6],
  ["format", 7],
  ["preview", 8],
]);

const SOURCE_PRIORITY: Record<RunActionSource, number> = {
  lsp: 0,
  custom: 1,
  package: 2,
  cargo: 3,
  just: 4,
  make: 5,
  go: 6,
  python: 7,
};

const MANIFEST_NAMES = [
  "package.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "Cargo.toml",
  "justfile",
  "Justfile",
  "Makefile",
  "makefile",
  "go.mod",
  "pyproject.toml",
] as const;

function createAction(
  source: RunActionSource,
  sourceLabel: string,
  name: string,
  command: string,
  workingDirectory: string,
  description?: string,
): RunActionItem {
  return {
    id: `detected:${source}:${command}`,
    name,
    command,
    description,
    source,
    sourceLabel,
    workingDirectory,
  };
}

function getPackageRunner(
  packageManager: unknown,
  availableManifestNames: ReadonlySet<string>,
): string {
  if (typeof packageManager === "string") {
    const manager = packageManager.split("@")[0]?.trim();
    if (manager === "bun" || manager === "pnpm" || manager === "yarn" || manager === "npm") {
      return manager;
    }
  }

  if (availableManifestNames.has("bun.lock") || availableManifestNames.has("bun.lockb")) {
    return "bun";
  }
  if (availableManifestNames.has("pnpm-lock.yaml")) return "pnpm";
  if (availableManifestNames.has("yarn.lock")) return "yarn";
  return "npm";
}

function getScriptPriority(name: string): number {
  const normalizedName = name.toLowerCase();
  const directPriority = SCRIPT_PRIORITY.get(normalizedName);
  if (directPriority != null) return directPriority;

  const prefixPriority = SCRIPT_PRIORITY.get(normalizedName.split(":")[0] ?? "");
  return prefixPriority != null ? prefixPriority + 20 : 100;
}

export function parsePackageRunActions(
  content: string,
  workspacePath: string,
  availableManifestNames: ReadonlySet<string> = new Set(["package.json"]),
): RunActionItem[] {
  try {
    const manifest = JSON.parse(content) as {
      packageManager?: unknown;
      scripts?: Record<string, unknown>;
    };
    if (!manifest.scripts || typeof manifest.scripts !== "object") return [];

    const runner = getPackageRunner(manifest.packageManager, availableManifestNames);
    return Object.entries(manifest.scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(
        ([left], [right]) =>
          getScriptPriority(left) - getScriptPriority(right) || left.localeCompare(right),
      )
      .slice(0, 40)
      .map(([name, script]) =>
        createAction(
          "package",
          "package.json",
          name,
          `${runner} run ${name}`,
          workspacePath,
          script,
        ),
      );
  } catch {
    return [];
  }
}

export function parseCargoRunActions(content: string, workspacePath: string): RunActionItem[] {
  const actions: RunActionItem[] = [];
  if (/\[package\]/.test(content)) {
    actions.push(createAction("cargo", "Cargo.toml", "Run", "cargo run", workspacePath));
  }
  actions.push(
    createAction("cargo", "Cargo.toml", "Test", "cargo test", workspacePath),
    createAction("cargo", "Cargo.toml", "Check", "cargo check", workspacePath),
    createAction("cargo", "Cargo.toml", "Build", "cargo build", workspacePath),
  );
  return actions;
}

function parseRecipeNames(content: string, pattern: RegExp): string[] {
  const names = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(?:#|\.|_)/.test(line)) continue;
    const match = line.match(pattern);
    const name = match?.[1]?.trim();
    if (!name || name.includes("%") || name.includes("$")) continue;
    names.add(name);
    if (names.size >= 30) break;
  }
  return Array.from(names);
}

export function parseMakefileRunActions(content: string, workspacePath: string): RunActionItem[] {
  return parseRecipeNames(content, /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/).map((name) =>
    createAction("make", "Makefile", name, `make ${name}`, workspacePath),
  );
}

export function parseJustfileRunActions(content: string, workspacePath: string): RunActionItem[] {
  return parseRecipeNames(content, /^([A-Za-z][A-Za-z0-9_-]*)[^:=]*:/).map((name) =>
    createAction("just", "justfile", name, `just ${name}`, workspacePath),
  );
}

function parseGoRunActions(workspacePath: string): RunActionItem[] {
  return [
    createAction("go", "go.mod", "Run", "go run .", workspacePath),
    createAction("go", "go.mod", "Test", "go test ./...", workspacePath),
    createAction("go", "go.mod", "Build", "go build ./...", workspacePath),
  ];
}

export function parsePyprojectRunActions(content: string, workspacePath: string): RunActionItem[] {
  const actions: RunActionItem[] = [];
  const scriptsSection = content.match(/\[project\.scripts\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";

  for (const line of scriptsSection.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/);
    if (!match?.[1]) continue;
    actions.push(
      createAction("python", "pyproject.toml", match[1], match[1], workspacePath, "Project script"),
    );
  }

  if (/(?:pytest|\[tool\.pytest)/i.test(content)) {
    actions.push(createAction("python", "pyproject.toml", "Test", "pytest", workspacePath));
  }

  return actions;
}

export function isRunnableCodeLens(lens: CodeLensItem): boolean {
  return Boolean(lens.command && /\b(run|test|debug|bench|profile)\b/i.test(lens.title));
}

export function codeLensesToRunActions(
  lenses: CodeLensItem[],
  activeFilePath: string,
): RunActionItem[] {
  const fileName = activeFilePath.split(/[\\/]/).pop() || activeFilePath;
  return lenses.filter(isRunnableCodeLens).map((lens, index) => ({
    id: `lsp:${activeFilePath}:${lens.line}:${lens.command}:${index}`,
    name: lens.title,
    description: `${fileName}:${lens.line + 1}`,
    source: "lsp",
    sourceLabel: "LSP",
    codeLens: lens,
  }));
}

function sortAndDedupeRunActions(actions: RunActionItem[]): RunActionItem[] {
  const seen = new Set<string>();
  return actions
    .filter((action) => {
      const key = `${action.command ?? action.codeLens?.command}:${action.workingDirectory ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source] ||
        getScriptPriority(left.name) - getScriptPriority(right.name) ||
        left.name.localeCompare(right.name),
    );
}

export function resolveRunWorkingDirectory(
  workspacePath: string | undefined,
  workingDirectory: string | undefined,
): string | undefined {
  const trimmed = workingDirectory?.trim();
  if (!trimmed || trimmed === ".") return workspacePath;
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("remote://") ||
    trimmed.startsWith("wsl://") ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  ) {
    return trimmed;
  }
  return workspacePath ? joinPath(workspacePath, trimmed) : trimmed;
}

async function readWorkspaceTextFile(path: string): Promise<string> {
  const remote = parseRemotePath(path);
  if (remote) {
    return invoke<string>("ssh_read_file", {
      connectionId: remote.connectionId,
      filePath: remote.remotePath,
    });
  }
  return readFileContent(path);
}

export async function discoverProjectRunActions(
  workspacePath: string,
  reader: (path: string) => Promise<string> = readWorkspaceTextFile,
): Promise<RunActionItem[]> {
  const entries = await Promise.all(
    MANIFEST_NAMES.map(async (name) => {
      try {
        return [name, await reader(joinPath(workspacePath, name))] as const;
      } catch {
        return null;
      }
    }),
  );
  const manifests: ManifestContents = new Map(
    entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
  const availableNames = new Set(manifests.keys());
  const actions: RunActionItem[] = [];
  const packageJson = manifests.get("package.json");
  if (packageJson) {
    actions.push(...parsePackageRunActions(packageJson, workspacePath, availableNames));
  }
  const cargoToml = manifests.get("Cargo.toml");
  if (cargoToml) actions.push(...parseCargoRunActions(cargoToml, workspacePath));
  const justfile = manifests.get("justfile") ?? manifests.get("Justfile");
  if (justfile) actions.push(...parseJustfileRunActions(justfile, workspacePath));
  const makefile = manifests.get("Makefile") ?? manifests.get("makefile");
  if (makefile) actions.push(...parseMakefileRunActions(makefile, workspacePath));
  if (manifests.has("go.mod")) actions.push(...parseGoRunActions(workspacePath));
  const pyproject = manifests.get("pyproject.toml");
  if (pyproject) actions.push(...parsePyprojectRunActions(pyproject, workspacePath));

  return sortAndDedupeRunActions(actions);
}
