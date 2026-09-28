import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { DEMO_HOME, DEMO_ROOT, demoFiles } from "@/features/web-demo/data/demo-project";
import { networkHandlers } from "@/features/web-demo/services/demo-network";

/**
 * A stand-in for the Rust side of Athas so the real frontend can run in a plain browser tab.
 * Every Tauri command goes through `invoke`; this answers the ones the workbench needs from an
 * in-memory project and returns empty results for the rest.
 */

type Args = Record<string, any> | undefined;
type Handler = (args: Args) => unknown;

const encoder = new TextEncoder();
const files = new Map<string, string>(
  Object.entries(demoFiles).map<[string, string]>(([path, content]) => [
    `${DEMO_ROOT}/${path}`,
    content,
  ]),
);

function directoriesOf(path: string) {
  const parts = path.split("/");
  const result: string[] = [];
  for (let index = 2; index < parts.length; index += 1) {
    result.push(parts.slice(0, index).join("/"));
  }
  return result;
}

const directories = new Set<string>([DEMO_HOME, DEMO_ROOT]);
for (const path of files.keys()) {
  for (const directory of directoriesOf(path)) directories.add(directory);
}

function normalize(path: unknown): string {
  const value = String(path ?? "");
  const withoutScheme = value.startsWith("file://") ? value.slice("file://".length) : value;
  return withoutScheme.replace(/\/+$/, "") || "/";
}

function listDirectory(path: string) {
  const prefix = `${normalize(path)}/`;
  const names = new Map<string, boolean>();
  for (const directory of directories) {
    if (directory.startsWith(prefix) && !directory.slice(prefix.length).includes("/")) {
      names.set(directory.slice(prefix.length), true);
    }
  }
  for (const file of files.keys()) {
    if (file.startsWith(prefix) && !file.slice(prefix.length).includes("/")) {
      names.set(file.slice(prefix.length), false);
    }
  }
  return [...names.entries()]
    .filter(([name]) => name.length > 0)
    .sort(([a, aDir], [b, bDir]) => (aDir === bDir ? a.localeCompare(b) : aDir ? -1 : 1))
    .map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false }));
}

function readText(path: unknown) {
  const content = files.get(normalize(path));
  if (content === undefined) throw new Error(`No such file: ${String(path)}`);
  return content;
}

function stat(path: unknown) {
  const target = normalize(path);
  const isDirectory = directories.has(target);
  const isFile = files.has(target);
  if (!isDirectory && !isFile) throw new Error(`No such file or directory: ${target}`);
  const now = Date.now();
  return {
    isFile,
    isDirectory,
    isSymlink: false,
    size: isFile ? encoder.encode(files.get(target)).length : 0,
    mtime: now,
    atime: now,
    birthtime: now,
    readonly: false,
    fileAttributes: null,
    dev: 0,
    ino: 0,
    mode: isDirectory ? 0o40755 : 0o100644,
    nlink: 1,
    uid: 501,
    gid: 20,
    rdev: 0,
    blksize: 4096,
    blocks: 0,
  };
}

function toBytes(content: string) {
  return Array.from(encoder.encode(content));
}

const storesByPath = new Map<string, Map<string, unknown>>();
const storeValues = new Map<number, Map<string, unknown>>();
let nextResourceId = 1;

/** Values a store starts with, keyed by the store file the app loads. */
export function seedStore(path: string, values: Record<string, unknown>) {
  storesByPath.set(path, new Map(Object.entries(values)));
}

const handlers: Record<string, Handler> = {
  // App, OS and window
  "plugin:app|version": () => "0.15.1",
  "plugin:app|name": () => "Athas",
  "plugin:app|tauri_version": () => "2.11.1",
  "plugin:app|identifier": () => "com.code.athas",
  "plugin:window|get_all_windows": () => ["main"],
  "plugin:window|is_maximized": () => false,
  "plugin:window|is_fullscreen": () => false,
  "plugin:window|is_focused": () => true,
  "plugin:window|is_visible": () => true,
  "plugin:window|scale_factor": () => window.devicePixelRatio || 2,
  "plugin:window|inner_size": () => ({ width: window.innerWidth, height: window.innerHeight }),
  "plugin:window|outer_size": () => ({ width: window.innerWidth, height: window.innerHeight }),
  "plugin:window|inner_position": () => ({ x: 0, y: 0 }),
  "plugin:window|outer_position": () => ({ x: 0, y: 0 }),
  "plugin:window|theme": () =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  "plugin:window|title": () => "Athas",
  "plugin:webview|get_all_webviews": () => [{ windowLabel: "main", label: "main" }],
  uses_native_window_chrome: () => false,
  get_system_accessibility_preferences: () => ({
    reduceTransparency: false,
    reduceMotion: false,
    increaseContrast: false,
    differentiateWithoutColor: false,
  }),
  get_system_fonts: () => [],
  list_shells: () => [],
  take_pending_deep_links: () => [],
  take_pending_cli_open_requests: () => [],
  get_bundled_extensions_path: () => `${DEMO_HOME}/.athas/bundled`,

  // Paths
  "plugin:path|resolve_directory": (args) => {
    const directory = Number(args?.directory);
    const base =
      directory === 11 ? DEMO_HOME : `${DEMO_HOME}/Library/Application Support/com.code.athas`;
    return args?.path ? `${base}/${args.path}` : base;
  },
  "plugin:path|join": (args) => ((args?.paths ?? []) as string[]).join("/").replace(/\/+/g, "/"),
  "plugin:path|normalize": (args) => normalize(args?.path),
  "plugin:path|resolve": (args) => ((args?.paths ?? []) as string[]).join("/").replace(/\/+/g, "/"),
  "plugin:path|dirname": (args) => String(args?.path).split("/").slice(0, -1).join("/") || "/",
  "plugin:path|basename": (args) => {
    const name = String(args?.path).split("/").pop() ?? "";
    return args?.ext && name.endsWith(args.ext) ? name.slice(0, -args.ext.length) : name;
  },
  "plugin:path|extname": (args) => String(args?.path).split(".").pop() ?? "",
  "plugin:path|is_absolute": (args) => String(args?.path).startsWith("/"),

  // Persistent store (settings, onboarding, sessions)
  "plugin:store|load": (args) => {
    const path = String(args?.path);
    const rid = nextResourceId++;
    if (!storesByPath.has(path)) storesByPath.set(path, new Map());
    storeValues.set(rid, storesByPath.get(path)!);
    return rid;
  },
  "plugin:store|get_store": () => null,
  "plugin:store|get": (args) => {
    const values = storeValues.get(Number(args?.rid));
    const key = String(args?.key);
    return values?.has(key) ? [values.get(key), true] : [null, false];
  },
  "plugin:store|has": (args) => storeValues.get(Number(args?.rid))?.has(String(args?.key)) ?? false,
  "plugin:store|set": (args) => {
    storeValues.get(Number(args?.rid))?.set(String(args?.key), args?.value);
    return null;
  },
  "plugin:store|delete": (args) =>
    storeValues.get(Number(args?.rid))?.delete(String(args?.key)) ?? false,
  "plugin:store|entries": (args) => [...(storeValues.get(Number(args?.rid))?.entries() ?? [])],
  "plugin:store|keys": (args) => [...(storeValues.get(Number(args?.rid))?.keys() ?? [])],
  "plugin:store|values": (args) => [...(storeValues.get(Number(args?.rid))?.values() ?? [])],
  "plugin:store|length": (args) => storeValues.get(Number(args?.rid))?.size ?? 0,

  // File system
  "plugin:fs|read_dir": (args) => listDirectory(String(args?.path)),
  "plugin:fs|exists": (args) => {
    const target = normalize(args?.path);
    return files.has(target) || directories.has(target);
  },
  "plugin:fs|stat": (args) => stat(args?.path),
  "plugin:fs|lstat": (args) => stat(args?.path),
  "plugin:fs|read_text_file": (args) => toBytes(readText(args?.path)),
  "plugin:fs|read_file": (args) => toBytes(readText(args?.path)),
  "plugin:fs|write_text_file": () => null,
  "plugin:fs|write_file": () => null,
  "plugin:fs|mkdir": () => null,
  read_local_file: (args) => toBytes(readText(args?.path)),
  get_symlink_info: (args) => ({
    is_symlink: false,
    target: null,
    is_dir: directories.has(normalize(args?.path)),
  }),

  // Accounts, extensions and chats
  github_check_auth: () => false,
  // Language integrations whose tree-sitter parsers ship in public/tree-sitter.
  list_installed_extensions: () =>
    ["typescript", "tsx", "javascript", "json", "yaml", "markdown", "css", "bash", "toml"].map(
      (name) => ({
        id: `athas.${name}`,
        name,
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
        enabled: true,
      }),
    ),
  load_all_chats: () => [],
  list_saved_connections: () => [],
  get_available_agents: () => [],
  "plugin:updater|check": () => null,

  // Tools the Athas Agent runs against the workspace
  intelligence_read_file: (args) => readText(`${normalize(args?.root)}/${args?.path}`),
  intelligence_list_files: (args) => {
    const prefix = `${normalize(args?.root)}/`;
    return {
      files: [...files.keys()]
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length)),
      nextOffset: null,
    };
  },
  intelligence_search_files: (args) => {
    const prefix = `${normalize(args?.root)}/`;
    const query = String(args?.options?.query ?? "").toLowerCase();
    const matches = [];
    for (const [path, content] of files) {
      if (!path.startsWith(prefix)) continue;
      const lines = content.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].toLowerCase().includes(query)) {
          matches.push({ path: path.slice(prefix.length), line: index + 1, text: lines[index] });
        }
      }
    }
    return { matches, truncated: false };
  },

  ...networkHandlers,

  // Git
  git_discover_repo: () => DEMO_ROOT,
  git_status: () => ({
    branch: "main",
    ahead: 1,
    behind: 0,
    files: [
      { path: "src/app/page.tsx", status: "modified", staged: false },
      { path: "src/lib/releases.ts", status: "added", staged: true },
    ],
  }),
  git_branches: () => ["main", "landing-hero"],
  git_get_branches: () => ["main", "landing-hero"],
  git_current_branch: () => "main",
};

export function installDemoBackend() {
  mockWindows("main");

  const internals = window as unknown as Record<string, any>;
  internals.__TAURI_OS_PLUGIN_INTERNALS__ = {
    platform: "macos",
    os_type: "macos",
    family: "unix",
    arch: "aarch64",
    eol: "\n",
    version: "15.0.0",
    exe_extension: "",
  };

  mockIPC(
    (cmd, args) => {
      const handler = handlers[cmd];
      if (handler) return handler(args as Args);
      // No language servers run in the preview; their queries come back empty.
      if (cmd.startsWith("lsp_get_")) return [];
      // Commands the preview has no use for (menus, telemetry, terminals) do nothing.
      return null;
    },
    { shouldMockEvents: true },
  );

  internals.__TAURI_INTERNALS__.plugins = {
    ...internals.__TAURI_INTERNALS__.plugins,
    path: { sep: "/", delimiter: ":" },
  };
  internals.__TAURI_INTERNALS__.convertFileSrc = (path: string) => path;
}
