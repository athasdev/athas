import type { FffIndexedFile, FffSearchHit, SearchOptions } from "@/bindings/commands";
import {
  type MemoryFileSystem,
  normalizePath,
} from "@/features/web-workbench/services/memory-file-system";
import type { MemoryGitRepository } from "@/features/web-workbench/services/memory-git";
import { networkHandlers } from "@/features/web-workbench/services/scripted-network";

/**
 * A stand-in for the Rust side of Athas so the real frontend runs in a plain browser tab. Every
 * Tauri command goes through `invoke`; this answers the ones the workbench needs from the
 * in-memory project and returns empty results for the rest.
 */

type Args = Record<string, any> | undefined;
type Handler = (args: Args) => unknown;

export interface WebBackendOptions {
  home: string;
  fs: MemoryFileSystem;
  git: MemoryGitRepository;
  appVersion: string;
}

export interface WebBackend {
  handle(command: string, args?: Args): unknown;
  /** Values a Tauri store starts with, keyed by the store file the app loads. */
  seedStore(path: string, values: Record<string, unknown>): void;
}

const encoder = new TextEncoder();

function toBytes(content: string) {
  return Array.from(encoder.encode(content));
}

function joinPaths(paths: unknown) {
  return ((paths ?? []) as string[]).join("/").replace(/\/+/g, "/");
}

function insideRoot(root: string, path: unknown) {
  const relative = String(path ?? "").replace(/^\.?\/+/, "");
  if (relative.split("/").includes("..")) throw new Error(`Path leaves the workspace: ${relative}`);
  return relative ? `${root}/${relative}` : root;
}

function fileStat(fs: MemoryFileSystem, path: unknown) {
  const stat = fs.stat(path);
  return {
    isFile: stat.isFile,
    isDirectory: stat.isDirectory,
    isSymlink: false,
    size: stat.size,
    mtime: stat.mtime,
    atime: stat.mtime,
    birthtime: stat.mtime,
    readonly: false,
    fileAttributes: null,
    dev: 0,
    ino: 0,
    mode: stat.isDirectory ? 0o40755 : 0o100644,
    nlink: 1,
    uid: 501,
    gid: 20,
    rdev: 0,
    blksize: 4096,
    blocks: 0,
  };
}

export function fuzzyScore(query: string, candidate: string) {
  const needle = query.toLowerCase();
  const haystack = candidate.toLowerCase();
  if (!needle) return 1;
  if (haystack.includes(needle)) return 1000 - haystack.indexOf(needle) - haystack.length;
  let position = 0;
  for (const character of needle) {
    position = haystack.indexOf(character, position);
    if (position === -1) return null;
    position += 1;
  }
  return 100 - haystack.length;
}

export function createWebBackend({ home, fs, git, appVersion }: WebBackendOptions): WebBackend {
  const storesByPath = new Map<string, Map<string, unknown>>();
  const storeValues = new Map<number, Map<string, unknown>>();
  let nextResourceId = 1;
  let nextWriteId = 1;

  const appData = `${home}/Library/Application Support/com.code.athas`;

  function workspaceWrite(root: unknown, path: unknown, content: string) {
    const target = insideRoot(normalizePath(root), path);
    const previousContent = fs.exists(target) ? fs.readText(target) : null;
    fs.writeText(target, content);
    return { writeId: nextWriteId++, path: target, previousContent, content };
  }

  function expectContent(path: string, expected: unknown) {
    if (expected === null || expected === undefined) return;
    const current = fs.exists(path) ? fs.readText(path) : null;
    if (current !== expected) throw new Error(`${path} changed on disk. Read it again first.`);
  }

  function indexedFiles(rootPaths: unknown): FffIndexedFile[] {
    const roots = ((rootPaths as string[] | undefined) ?? [git.root]).map(normalizePath);
    return roots.flatMap((root) =>
      fs.listFiles(root).map((relative) => ({
        path: `${root}/${relative}`,
        name: relative.split("/").pop() ?? relative,
        relative_path: relative,
      })),
    );
  }

  const handlers: Record<string, Handler> = {
    // App, OS and window
    "plugin:app|version": () => appVersion,
    "plugin:app|name": () => "Athas",
    "plugin:app|tauri_version": () => "2.11.1",
    "plugin:app|identifier": () => "com.code.athas",
    "plugin:window|get_all_windows": () => ["main"],
    "plugin:window|is_maximized": () => false,
    "plugin:window|is_fullscreen": () => false,
    "plugin:window|is_focused": () => true,
    "plugin:window|is_visible": () => true,
    "plugin:window|scale_factor": () => window.devicePixelRatio || 1,
    "plugin:window|inner_size": () => ({ width: window.innerWidth, height: window.innerHeight }),
    "plugin:window|outer_size": () => ({ width: window.innerWidth, height: window.innerHeight }),
    "plugin:window|inner_position": () => ({ x: 0, y: 0 }),
    "plugin:window|outer_position": () => ({ x: 0, y: 0 }),
    "plugin:window|theme": () =>
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    "plugin:window|title": () => "Athas",
    "plugin:webview|get_all_webviews": () => [{ windowLabel: "main", label: "main" }],
    uses_native_window_chrome: () => false,
    get_system_theme: () =>
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    get_system_accessibility_preferences: () => ({
      reduceTransparency: false,
      reduceMotion: false,
      increaseContrast: false,
      differentiateWithoutColor: false,
    }),
    get_system_fonts: () => [],
    get_monospace_fonts: () => [],
    list_shells: () => [],
    take_pending_deep_links: () => [],
    take_pending_cli_open_requests: () => [],
    get_bundled_extensions_path: () => `${appData}/bundled`,
    self_update_supported: () => false,
    "plugin:updater|check": () => null,
    // The project picker lists WSL distributions, which a browser never has.
    wsl_list_distributions: () => [],

    // Paths
    "plugin:path|resolve_directory": (args) => {
      const base = Number(args?.directory) === 11 ? home : appData;
      return args?.path ? `${base}/${args.path}` : base;
    },
    "plugin:path|join": (args) => joinPaths(args?.paths),
    "plugin:path|normalize": (args) => normalizePath(args?.path),
    "plugin:path|resolve": (args) => joinPaths(args?.paths),
    "plugin:path|dirname": (args) => String(args?.path).split("/").slice(0, -1).join("/") || "/",
    "plugin:path|basename": (args) => {
      const name = String(args?.path).split("/").pop() ?? "";
      return args?.ext && name.endsWith(args.ext) ? name.slice(0, -args.ext.length) : name;
    },
    "plugin:path|extname": (args) => String(args?.path).split(".").pop() ?? "",
    "plugin:path|is_absolute": (args) => String(args?.path).startsWith("/"),

    // Persistent stores (settings, onboarding, sessions) live in memory for the visit.
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
    "plugin:store|has": (args) =>
      storeValues.get(Number(args?.rid))?.has(String(args?.key)) ?? false,
    "plugin:store|set": (args) => {
      storeValues.get(Number(args?.rid))?.set(String(args?.key), args?.value);
      return null;
    },
    "plugin:store|delete": (args) =>
      storeValues.get(Number(args?.rid))?.delete(String(args?.key)) ?? false,
    "plugin:store|clear": (args) => {
      storeValues.get(Number(args?.rid))?.clear();
      return null;
    },
    "plugin:store|entries": (args) => [...(storeValues.get(Number(args?.rid))?.entries() ?? [])],
    "plugin:store|keys": (args) => [...(storeValues.get(Number(args?.rid))?.keys() ?? [])],
    "plugin:store|values": (args) => [...(storeValues.get(Number(args?.rid))?.values() ?? [])],
    "plugin:store|length": (args) => storeValues.get(Number(args?.rid))?.size ?? 0,

    // File system
    // Optional folders the workbench probes for (agent rules, editor config) simply do not exist.
    "plugin:fs|read_dir": (args) => (fs.isDirectory(args?.path) ? fs.list(args?.path) : []),
    "plugin:fs|exists": (args) => fs.exists(args?.path),
    "plugin:fs|stat": (args) => fileStat(fs, args?.path),
    "plugin:fs|lstat": (args) => fileStat(fs, args?.path),
    "plugin:fs|read_text_file": (args) => toBytes(fs.readText(args?.path)),
    "plugin:fs|read_file": (args) => toBytes(fs.readText(args?.path)),
    "plugin:fs|write_text_file": () => null,
    "plugin:fs|write_file": () => null,
    "plugin:fs|mkdir": (args) => {
      fs.mkdir(args?.path);
      return null;
    },
    "plugin:fs|remove": (args) => {
      fs.remove(args?.path);
      return null;
    },
    "plugin:fs|rename": (args) => {
      fs.rename(args?.oldPath, args?.newPath);
      return null;
    },
    read_local_file: (args) => toBytes(fs.readText(args?.path)),
    write_local_file: (args) => {
      fs.writeText(args?.path, String(args?.content ?? ""));
      return null;
    },
    write_local_file_checked: (args) => {
      const path = normalizePath(args?.path);
      const expected = args?.expected as { byteLength: number } | null | undefined;
      if (expected && fs.exists(path) && fs.stat(path).size !== expected.byteLength) {
        throw new Error(`${path} changed on disk.`);
      }
      fs.writeText(path, String(args?.content ?? ""));
      return null;
    },
    delete_local_file_checked: (args) => {
      const path = normalizePath(args?.path);
      expectContent(path, args?.expectedContent);
      fs.remove(path);
      return null;
    },
    move_file: (args) => {
      fs.rename(args?.sourcePath, args?.targetPath);
      return null;
    },
    rename_file: (args) => {
      fs.rename(args?.sourcePath, args?.targetPath);
      return null;
    },
    get_local_directory_size: (args) =>
      fs
        .listFiles(args?.path)
        .reduce((total, path) => total + fs.stat(`${normalizePath(args?.path)}/${path}`).size, 0),
    get_symlink_info: (args) => ({
      is_symlink: false,
      target: null,
      is_dir: fs.isDirectory(args?.path),
    }),

    // Quick open
    fff_ensure_workspaces: () => null,
    fff_track_access: () => null,
    fff_scan_status: () => ({
      is_scanning: false,
      scanned_files_count: fs.listFiles(git.root).length,
      indexed_files: fs.listFiles(git.root).length,
      is_watcher_ready: true,
      is_warmup_complete: true,
    }),
    fff_list_files: (args) => indexedFiles(args?.rootPaths),
    fff_search_files: (args) => {
      const query = String(args?.query ?? "");
      const hits: FffSearchHit[] = [];
      for (const file of indexedFiles(args?.rootPaths)) {
        const score = fuzzyScore(query, file.relative_path);
        if (score !== null) hits.push({ ...file, score });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, Number(args?.limit) || 50);
    },

    // Accounts, extensions and chats
    github_check_auth: () => "notAuthenticated",
    list_installed_extensions: () => [],
    load_all_chats: () => [],
    search_chats: () => [],
    list_saved_connections: () => [],
    get_available_agents: () => [],

    // Tools the Athas Agent runs against the workspace
    intelligence_read_file: (args) =>
      fs.readText(insideRoot(normalizePath(args?.root), args?.path)),
    intelligence_list_files: (args) => {
      const root = normalizePath(args?.root);
      const folder = args?.options?.path ? String(args.options.path).replace(/\/+$/, "") : "";
      const all = fs.listFiles(root).filter((path) => !folder || path.startsWith(`${folder}/`));
      const offset = Number(args?.options?.offset) || 0;
      const limit = Number(args?.options?.limit) || all.length;
      const page = all.slice(offset, offset + limit);
      return {
        files: page,
        total: all.length,
        nextOffset: offset + page.length < all.length ? offset + page.length : null,
        truncated: false,
      };
    },
    intelligence_search_files: (args) => {
      const options = (args?.options ?? {}) as Partial<SearchOptions>;
      const query = String(options.query ?? "");
      const caseSensitive = options.caseSensitive ?? /[A-Z]/.test(query);
      const matches = fs.search(args?.root, query, caseSensitive);
      const limit = options.maxResults ?? 200;
      return {
        matches: matches.slice(0, limit),
        truncated: matches.length > limit,
        filesSearched: fs.listFiles(args?.root).length,
      };
    },
    intelligence_paths_stay_in_workspace: (args) =>
      ((args?.paths ?? []) as string[]).every(
        (path) => !String(path).split("/").includes("..") && !String(path).startsWith("/"),
      ),
    intelligence_write_file: (args) => {
      const target = insideRoot(normalizePath(args?.root), args?.path);
      expectContent(target, args?.expectedContent);
      return workspaceWrite(args?.root, args?.path, String(args?.content ?? ""));
    },
    intelligence_edit_file: (args) => {
      const target = insideRoot(normalizePath(args?.root), args?.path);
      expectContent(target, args?.expectedContent);
      let content = fs.readText(target);
      for (const edit of (args?.edits ?? []) as Array<{
        oldText: string;
        newText: string;
        replaceAll?: boolean;
      }>) {
        if (!content.includes(edit.oldText)) throw new Error(`Text not found in ${args?.path}`);
        content = edit.replaceAll
          ? content.split(edit.oldText).join(edit.newText)
          : content.replace(edit.oldText, edit.newText);
      }
      return workspaceWrite(args?.root, args?.path, content);
    },
    intelligence_delete_file: (args) => {
      const target = insideRoot(normalizePath(args?.root), args?.path);
      expectContent(target, args?.expectedContent);
      fs.remove(target);
      return target;
    },
    intelligence_run_command: () => {
      throw new Error("The web editor cannot run commands yet.");
    },

    ...networkHandlers,

    // Git
    git_discover_repo: (args) => (git.contains(normalizePath(args?.path)) ? git.root : null),
    git_status: () => git.status(),
    git_add: (args) => git.add(args?.filePath) ?? null,
    git_add_all: () => git.addAll() ?? null,
    git_reset: (args) => git.reset(args?.filePath) ?? null,
    git_reset_all: () => git.resetAll() ?? null,
    git_commit: (args) => git.commit(String(args?.message ?? "")) ?? null,
    git_log: (args) => git.log(args?.limit, args?.skip),
    git_diff_file: (args) => git.diff(args?.filePath, Boolean(args?.staged)),
    git_diff_file_with_content: (args) =>
      git.diff(args?.filePath, false, String(args?.content ?? "")),
    git_status_diff_stats: () => git.diffStats(),
    git_blame_file: (args) => git.blame(args?.filePath, args?.content),
    git_prewarm_blame: () => null,
    git_file_at_commit: (args) => git.fileAtHead(args?.filePath),
    git_discard_file_changes: (args) => git.discard(args?.filePath) ?? null,
    git_discard_all_changes: () => git.discardAll() ?? null,
    git_branches: () => git.listBranches(),
    git_get_branches: () => git.listBranches(),
    git_current_branch: () => git.currentBranch(),
    git_create_branch: (args) => git.createBranch(String(args?.branchName)) ?? null,
    git_checkout: (args) => git.checkout(String(args?.branchName)),
    git_get_remotes: () => [{ name: "origin", url: "https://github.com/you/sample-site.git" }],
    git_get_stashes: () => [],
    git_get_tags: () => [],
    git_get_worktrees: () => [],
    git_push: () => {
      throw new Error("The web editor cannot push yet.");
    },
    git_pull: () => {
      throw new Error("The web editor cannot pull yet.");
    },
    git_fetch: () => null,
  };

  return {
    handle(command, args) {
      const handler = handlers[command];
      if (handler) return handler(args);
      // No language servers run in the browser; their queries come back empty.
      if (command.startsWith("lsp_get_")) return [];
      // Commands the web editor has no use for (menus, telemetry, terminals) do nothing.
      return null;
    },
    seedStore(path, values) {
      storesByPath.set(path, new Map(Object.entries(values)));
    },
  };
}
