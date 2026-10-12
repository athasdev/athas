import {
  type ContentSearchEvent,
  type FffIndexedFile,
  type FffSearchHit,
  type FileSearchResult,
  type GitCommit,
  type GitDiffStat,
  type GitStatus,
  type SearchFilesRequest,
  type TerminalInput,
  WORKSPACE_FILE_CHANGES_EVENT,
  type WorkspaceFileChanges,
} from "@/bindings/commands";
import { diffLines } from "@/features/web-workbench/services/memory-git";
import { fuzzyScore, type WebBackend } from "@/features/web-workbench/services/web-backend";
import type { WorkspaceTransport } from "@/features/web-workbench/services/workspace-connection";
import {
  base64ToBytes,
  bytesToBase64,
  parseUnifiedPatch,
  patchToGitDiff,
} from "@/features/web-workbench/services/workspace-protocol";

/**
 * Routes the workbench's Tauri commands for a cloud workspace to the athas-cloud Worker. Paths
 * under the workspace root (the repository's directory in the sandbox, used as is) go to the
 * workspace API; everything else, such as settings stores, app data and window state, stays
 * with the in-memory `base` backend. File changes and terminal output from the workspace socket
 * become the same events and channel messages the desktop backend sends.
 */

type Args = Record<string, any> | undefined;
type Handler = (args: Args) => unknown;

/** Anything with the `onmessage` of a Tauri `Channel`, which mockIPC passes through as is. */
interface ChannelLike {
  onmessage: (message: unknown) => void;
}

export interface RemoteBackendOptions {
  base: WebBackend;
  transport: WorkspaceTransport;
  root: string;
  /** Emits a Tauri event, as `emit` from `@tauri-apps/api/event` does. */
  emit: (event: string, payload: unknown) => unknown;
}

interface StatResult {
  type: string;
  size: number;
  mode: number;
  mtime: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SHELLS = [
  {
    id: "bash",
    name: "Bash",
    exec_win: null,
    exec_unix: "bash",
    kind: null,
    wsl_distribution: null,
  },
];
/** Output that arrives before `terminal.create` answers waits here for its channel. */
const MAX_EARLY_OUTPUT_CHUNKS = 64;

function normalize(path: unknown) {
  const value = String(path ?? "");
  const withoutScheme = value.startsWith("file://") ? value.slice("file://".length) : value;
  return withoutScheme.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}

function toFileInfo(stat: StatResult) {
  const isDirectory = stat.type === "directory";
  return {
    isFile: stat.type === "file",
    isDirectory,
    isSymlink: stat.type === "symlink",
    size: stat.size,
    mtime: stat.mtime,
    atime: stat.mtime,
    birthtime: stat.mtime,
    readonly: false,
    fileAttributes: null,
    dev: 0,
    ino: 0,
    mode: stat.mode,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 4096,
    blocks: 0,
  };
}

function inputBytes(input: TerminalInput | undefined) {
  if (!input) return { data: "" };
  return input.kind === "text"
    ? { data: input.data }
    : { bytes: bytesToBase64(Uint8Array.from(input.data)) };
}

export function createRemoteBackend({
  base,
  transport,
  root,
  emit,
}: RemoteBackendOptions): WebBackend {
  const workspaceRoot = normalize(root);
  const channels = new Map<string, ChannelLike>();
  const earlyOutput = new Map<string, Uint8Array[]>();
  let fileList: Promise<string[]> | null = null;

  /** The path relative to the workspace root, or null when it lies outside it. */
  function relative(path: unknown) {
    const value = normalize(path);
    if (value === workspaceRoot) return "";
    return value.startsWith(`${workspaceRoot}/`) ? value.slice(workspaceRoot.length + 1) : null;
  }

  /** A repository path from a git command, which may be absolute or relative. */
  function repoPath(path: unknown) {
    return relative(path) ?? String(path ?? "").replace(/^\.?\/+/, "");
  }

  function listFiles() {
    fileList ??= transport
      .call<{ files: string[] }>("fs.list")
      .then((result) => result.files)
      .catch((error) => {
        fileList = null;
        throw error;
      });
    return fileList;
  }

  async function readBytes(path: string) {
    const { content } = await transport.call<{ content: string }>("fs.read", { path });
    return base64ToBytes(content);
  }

  async function readText(path: string) {
    return decoder.decode(await readBytes(path));
  }

  async function write(path: string, content: string, expectedSize?: number) {
    await transport.call("fs.write", {
      path,
      content: bytesToBase64(encoder.encode(content)),
      ...(expectedSize === undefined ? {} : { expectedSize }),
    });
  }

  async function exists(path: string) {
    return (await transport.call<{ exists: boolean }>("fs.exists", { path })).exists;
  }

  async function status(): Promise<GitStatus> {
    const result = await transport.call<GitStatus>("git.status");
    return {
      branch: result.branch,
      ahead: result.ahead,
      behind: result.behind,
      files: result.files,
    };
  }

  async function fileAtHead(path: string) {
    try {
      const { content } = await transport.call<{ content: string }>("git.show", {
        path,
        rev: "HEAD",
      });
      return decoder.decode(base64ToBytes(content));
    } catch {
      return null;
    }
  }

  async function diffStats(): Promise<GitDiffStat[]> {
    const [staged, unstaged] = await Promise.all([
      transport.call<{ patch: string }>("git.diff", { staged: true }),
      transport.call<{ patch: string }>("git.diff", { staged: false }),
    ]);
    return [
      ...parseUnifiedPatch(staged.patch).map((file) => ({ file, staged: true })),
      ...parseUnifiedPatch(unstaged.patch).map((file) => ({ file, staged: false })),
    ].map(({ file, staged: isStaged }) => ({
      file_path: file.path,
      staged: isStaged,
      additions: file.additions,
      deletions: file.deletions,
    }));
  }

  async function indexedFiles(): Promise<FffIndexedFile[]> {
    return (await listFiles()).map((path) => ({
      path: `${workspaceRoot}/${path}`,
      name: path.split("/").pop() ?? path,
      relative_path: path,
    }));
  }

  async function searchContent(request: SearchFilesRequest, channel: ChannelLike | undefined) {
    const send = (event: ContentSearchEvent) => channel?.onmessage(event);
    const result = await transport.call<{
      results: Array<{
        path: string;
        matches: Array<{
          line: number;
          text: string;
          ranges: Array<{ start: number; end: number }>;
          before: string[];
          after: string[];
        }>;
      }>;
      truncated: boolean;
    }>("search.content", {
      query: request.query,
      regex: request.use_regex === true,
      caseSensitive: request.case_sensitive ?? null,
      wholeWord: request.whole_word === true,
      maxResults: request.max_results ?? 1000,
      contextLines: request.context_lines ?? 0,
    });
    const results: FileSearchResult[] = result.results.map((file) => ({
      file_path: `${workspaceRoot}/${file.path}`,
      total_matches: file.matches.length,
      matches: file.matches.map((match) => ({
        line_number: match.line,
        line_content: match.text,
        column_start: match.ranges[0]?.start ?? 0,
        column_end: match.ranges[0]?.end ?? 0,
        match_ranges: match.ranges,
        context_before: match.before,
        context_after: match.after,
      })),
    }));
    send({
      kind: "results",
      results,
      searched_files: results.length,
      searchable_files: results.length,
    });
    send({
      kind: "done",
      summary: {
        total_files: results.length,
        searched_files: results.length,
        searchable_files: results.length,
        next_file_offset: 0,
        has_more: result.truncated,
        indexed_files: results.length,
        regex_fallback_error: null,
        cancelled: false,
      },
    });
    return null;
  }

  transport.onTerminalOutput((id, data) => {
    const channel = channels.get(id);
    if (channel) {
      channel.onmessage(data.slice().buffer);
      return;
    }
    const pending = earlyOutput.get(id) ?? [];
    if (pending.length < MAX_EARLY_OUTPUT_CHUNKS) pending.push(data.slice());
    earlyOutput.set(id, pending);
  });

  transport.onEvent((event) => {
    if (event.type === "terminal.exit") {
      channels.get(event.id)?.onmessage({ event: "exit", exitCode: event.exitCode, signal: null });
      channels.delete(event.id);
      return;
    }
    if (event.type === "reconnected") {
      // Redraw the terminals that survived the drop.
      for (const id of channels.keys()) {
        if (event.workspace.terminals.includes(id))
          void transport.call("terminal.attach", { id }).catch(() => {});
        else {
          channels.get(id)?.onmessage({ event: "closed" });
          channels.delete(id);
        }
      }
      fileList = null;
      return;
    }
    if (event.type === "stopped") {
      for (const channel of channels.values()) channel.onmessage({ event: "closed" });
      channels.clear();
      return;
    }
    if (event.type !== "fs.changes") return;
    if (event.rescan || event.changes.some((change) => change.kind !== "modified")) fileList = null;
    const payload: WorkspaceFileChanges = {
      root: workspaceRoot,
      changes: event.changes.map((change) => ({
        path: `${workspaceRoot}/${change.path}`,
        kind: change.kind,
        is_dir: change.isDir,
      })),
      git_changed: event.gitChanged,
      rescan: event.rescan,
    };
    void emit(WORKSPACE_FILE_CHANGES_EVENT, payload);
  });

  /** Handlers that take a path: they run remotely only when it is inside the workspace. */
  const pathHandlers: Record<
    string,
    { path: (args: Args) => unknown; run: (path: string, args: Args) => unknown }
  > = {
    "plugin:fs|read_dir": {
      path: (args) => args?.path,
      run: async (path) => {
        const { entries } = await transport.call<{
          entries: Array<{ name: string; type: string }>;
        }>("fs.readdir", { path });
        return entries
          .map((entry) => ({
            name: entry.name,
            isDirectory: entry.type === "directory",
            isFile: entry.type === "file",
            isSymlink: entry.type === "symlink",
          }))
          .sort((a, b) =>
            a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
          );
      },
    },
    "plugin:fs|exists": { path: (args) => args?.path, run: (path) => exists(path) },
    "plugin:fs|stat": {
      path: (args) => args?.path,
      run: async (path) => toFileInfo(await transport.call<StatResult>("fs.stat", { path })),
    },
    "plugin:fs|lstat": {
      path: (args) => args?.path,
      run: async (path) => toFileInfo(await transport.call<StatResult>("fs.stat", { path })),
    },
    "plugin:fs|read_text_file": {
      path: (args) => args?.path,
      run: async (path) => Array.from(await readBytes(path)),
    },
    "plugin:fs|read_file": {
      path: (args) => args?.path,
      run: async (path) => Array.from(await readBytes(path)),
    },
    "plugin:fs|mkdir": {
      path: (args) => args?.path,
      run: async (path, args) => {
        await transport.call("fs.mkdir", { path, recursive: args?.options?.recursive !== false });
        return null;
      },
    },
    "plugin:fs|remove": {
      path: (args) => args?.path,
      run: async (path, args) => {
        await transport.call("fs.remove", { path, recursive: args?.options?.recursive ?? true });
        return null;
      },
    },
    "plugin:fs|rename": {
      path: (args) => args?.oldPath,
      run: async (path, args) => {
        await transport.call("fs.rename", { from: path, to: relative(args?.newPath) });
        return null;
      },
    },
    read_local_file: {
      path: (args) => args?.path,
      run: async (path) => Array.from(await readBytes(path)),
    },
    write_local_file: {
      path: (args) => args?.path,
      run: async (path, args) => {
        await write(path, String(args?.content ?? ""));
        return null;
      },
    },
    write_local_file_checked: {
      path: (args) => args?.path,
      run: async (path, args) => {
        const expected = args?.expected as { byteLength?: number } | null | undefined;
        await write(path, String(args?.content ?? ""), expected?.byteLength ?? undefined);
        return null;
      },
    },
    delete_local_file_checked: {
      path: (args) => args?.path,
      run: async (path, args) => {
        const expected = args?.expectedContent;
        await transport.call("fs.remove", {
          path,
          recursive: true,
          ...(typeof expected === "string"
            ? { expectedContent: bytesToBase64(encoder.encode(expected)) }
            : {}),
        });
        return null;
      },
    },
    move_file: {
      path: (args) => args?.sourcePath,
      run: async (path, args) => {
        await transport.call("fs.rename", { from: path, to: relative(args?.targetPath) });
        return null;
      },
    },
    rename_file: {
      path: (args) => args?.sourcePath,
      run: async (path, args) => {
        await transport.call("fs.rename", { from: path, to: relative(args?.targetPath) });
        return null;
      },
    },
    get_local_directory_size: { path: (args) => args?.path, run: () => 0 },
    get_symlink_info: {
      path: (args) => args?.path,
      run: async (path) => {
        const stat = await transport.call<StatResult>("fs.stat", { path }).catch(() => null);
        return {
          is_symlink: stat?.type === "symlink",
          target: null,
          is_dir: stat?.type === "directory",
        };
      },
    },

    // Tools the Athas Agent runs against the workspace.
    intelligence_read_file: {
      path: (args) => args?.root,
      run: (path, args) => readText(joinRelative(path, args?.path)),
    },
    intelligence_list_files: {
      path: (args) => args?.root,
      run: async (path, args) => {
        const folder = joinRelative(
          path,
          args?.options?.path ? String(args.options.path).replace(/\/+$/, "") : "",
        );
        const all = (await listFiles()).filter((file) => !folder || file.startsWith(`${folder}/`));
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
    },
    intelligence_search_files: {
      path: (args) => args?.root,
      run: async (path, args) => {
        const options = args?.options ?? {};
        const glob = options.glob ? String(options.glob) : path ? `${path}/**` : null;
        const limit = Number(options.maxResults) || 200;
        const result = await transport.call<{
          results: Array<{ path: string; matches: Array<{ line: number; text: string }> }>;
          truncated: boolean;
        }>("search.content", {
          query: String(options.query ?? ""),
          regex: options.regex === true,
          caseSensitive: options.caseSensitive ?? null,
          maxResults: limit,
          ...(glob ? { glob } : {}),
        });
        const matches = result.results.flatMap((file) =>
          file.matches.map((match) => ({ path: file.path, line: match.line, text: match.text })),
        );
        return { matches, truncated: result.truncated, filesSearched: result.results.length };
      },
    },
    intelligence_write_file: {
      path: (args) => args?.root,
      run: async (path, args) => {
        const target = joinRelative(path, args?.path);
        const previousContent = (await exists(target)) ? await readText(target) : null;
        expectContent(target, previousContent, args?.expectedContent);
        const content = String(args?.content ?? "");
        await write(target, content);
        return {
          writeId: nextWriteId++,
          path: `${workspaceRoot}/${target}`,
          previousContent,
          content,
        };
      },
    },
    intelligence_edit_file: {
      path: (args) => args?.root,
      run: async (path, args) => {
        const target = joinRelative(path, args?.path);
        const previousContent = await readText(target);
        expectContent(target, previousContent, args?.expectedContent);
        let content = previousContent;
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
        await write(target, content);
        return {
          writeId: nextWriteId++,
          path: `${workspaceRoot}/${target}`,
          previousContent,
          content,
        };
      },
    },
    intelligence_delete_file: {
      path: (args) => args?.root,
      run: async (path, args) => {
        const target = joinRelative(path, args?.path);
        if (args?.expectedContent !== undefined && args?.expectedContent !== null)
          expectContent(target, await readText(target), args.expectedContent);
        await transport.call("fs.remove", { path: target, recursive: false });
        return `${workspaceRoot}/${target}`;
      },
    },
  };

  let nextWriteId = 1;

  function joinRelative(base: string, path: unknown) {
    const child = String(path ?? "").replace(/^\.?\/+/, "");
    if (child.split("/").includes("..")) throw new Error(`Path leaves the workspace: ${child}`);
    return [base, child].filter(Boolean).join("/");
  }

  function expectContent(path: string, current: string | null, expected: unknown) {
    if (expected === null || expected === undefined) return;
    if (current !== expected) throw new Error(`${path} changed on disk. Read it again first.`);
  }

  const handlers: Record<string, Handler> = {
    // Quick open
    fff_ensure_workspaces: () => null,
    fff_track_access: () => null,
    fff_scan_status: async () => {
      const count = (await listFiles()).length;
      return {
        is_scanning: false,
        scanned_files_count: count,
        indexed_files: count,
        is_watcher_ready: true,
        is_warmup_complete: true,
      };
    },
    fff_list_files: () => indexedFiles(),
    fff_search_files: async (args) => {
      const query = String(args?.query ?? "");
      const hits: FffSearchHit[] = [];
      for (const file of await indexedFiles()) {
        const score = fuzzyScore(query, file.relative_path);
        if (score !== null) hits.push({ ...file, score });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, Number(args?.limit) || 50);
    },
    search_files_content_stream: (args) =>
      searchContent(args?.request as SearchFilesRequest, args?.onEvent as ChannelLike | undefined),
    cancel_ipc_stream: () => null,

    // Terminals
    list_shells: () => SHELLS,
    warm_terminal_environment: () => null,
    begin_frontend_terminal_session: () => null,
    create_terminal: async (args) => {
      const config = args?.config ?? {};
      const cwd = config.workingDirectory ? relative(config.workingDirectory) : null;
      const { id } = await transport.call<{ id: string }>("terminal.create", {
        cols: Number(config.size?.cols) || 80,
        rows: Number(config.size?.rows) || 24,
        ...(cwd ? { cwd } : {}),
        ...(config.environment ? { env: config.environment } : {}),
        ...(config.command ? { command: config.command, args: config.args ?? [] } : {}),
      });
      const channel = args?.onEvent as ChannelLike | undefined;
      if (channel) {
        channels.set(id, channel);
        for (const chunk of earlyOutput.get(id) ?? []) channel.onmessage(chunk.buffer);
      }
      earlyOutput.delete(id);
      return id;
    },
    terminal_write: async (args) => {
      await transport.call("terminal.write", { id: args?.id, ...inputBytes(args?.input) });
      return null;
    },
    terminal_resize: async (args) => {
      await transport.call("terminal.resize", {
        id: args?.id,
        cols: Number(args?.size?.cols),
        rows: Number(args?.size?.rows),
      });
      return null;
    },
    terminal_set_paused: async (args) => {
      await transport.call("terminal.pause", { id: args?.id, paused: args?.paused === true });
      return null;
    },
    close_terminal: async (args) => {
      channels.delete(String(args?.id));
      await transport.call("terminal.close", { id: args?.id }).catch(() => {});
      return null;
    },

    // Git
    git_discover_repo: (args) => (relative(args?.path) === null ? null : workspaceRoot),
    git_status: () => status(),
    git_add: async (args) => {
      await transport.call("git.add", { paths: [repoPath(args?.filePath)] });
      return null;
    },
    git_add_all: async () => {
      await transport.call("git.add", { all: true });
      return null;
    },
    git_reset: async (args) => {
      await transport.call("git.reset", { paths: [repoPath(args?.filePath)] });
      return null;
    },
    git_reset_all: async () => {
      await transport.call("git.reset", { all: true });
      return null;
    },
    git_commit: async (args) => {
      await transport.call("git.commit", { message: String(args?.message ?? "") });
      return null;
    },
    git_log: async (args) => {
      const { commits } = await transport.call<{ commits: GitCommit[] }>("git.log", {
        limit: args?.limit ?? 50,
        skip: args?.skip ?? 0,
      });
      return commits;
    },
    git_diff_file: async (args) => {
      const path = repoPath(args?.filePath);
      const { patch } = await transport.call<{ patch: string }>("git.diff", {
        path,
        staged: args?.staged === true,
      });
      return patchToGitDiff(parseUnifiedPatch(patch)[0], path);
    },
    git_diff_file_with_content: async (args) => {
      const path = repoPath(args?.filePath);
      const before = await fileAtHead(path);
      const after = String(args?.content ?? "");
      const lines = diffLines(before ?? "", after);
      return {
        ...patchToGitDiff(undefined, path),
        is_new: before === null,
        old_path: before === null ? null : path,
        lines,
        additions: lines.filter((line) => line.line_type === "added").length,
        deletions: lines.filter((line) => line.line_type === "removed").length,
      };
    },
    git_status_diff_stats: () => diffStats(),
    // Blame needs per-line history the workspace API does not serve yet.
    git_blame_file: (args) => ({ file_path: repoPath(args?.filePath), commits: [], hunks: [] }),
    git_prewarm_blame: () => null,
    git_file_at_commit: async (args) => {
      const path = repoPath(args?.filePath);
      const { content } = await transport.call<{ content: string }>("git.show", {
        path,
        rev: String(args?.commitHash ?? "HEAD"),
      });
      return decoder.decode(base64ToBytes(content));
    },
    git_discard_file_changes: async (args) => {
      await transport.call("git.discard", { paths: [repoPath(args?.filePath)] });
      return null;
    },
    git_discard_all_changes: async () => {
      await transport.call("git.discard", { all: true });
      return null;
    },
    git_branches: async () => (await transport.call<{ local: string[] }>("git.branches")).local,
    git_get_branches: async () => (await transport.call<{ local: string[] }>("git.branches")).local,
    git_current_branch: async () => (await status()).branch,
    git_create_branch: async (args) => {
      if (args?.fromBranch) await transport.call("git.checkout", { branch: args.fromBranch });
      await transport.call("git.checkout", { branch: args?.branchName, create: true });
      return null;
    },
    git_checkout: async (args) => {
      const branch = String(args?.branchName ?? "");
      const changes = (await status()).files.length > 0;
      await transport.call("git.checkout", { branch });
      return { success: true, hasChanges: changes, message: `Switched to branch '${branch}'` };
    },
    git_get_remotes: () => [{ name: "origin", url: "" }],
    git_get_stashes: () => [],
    git_get_tags: () => [],
    git_get_worktrees: () => [],
    git_push: async () => {
      await transport.call("git.push");
      return null;
    },
    git_pull: async () => {
      await transport.call("git.pull");
      return null;
    },
    git_fetch: async () => {
      await transport.call("git.fetch");
      return null;
    },
    // Opened by the Worker through the GitHub REST API with the user's token.
    github_create_pull_request: async (args) => {
      const head = String(args?.head ?? "");
      const base = String(args?.base ?? "");
      const { url, number } = await transport.call<{ url: string; number: number }>(
        "github.createPullRequest",
        {
          title: String(args?.title ?? ""),
          body: String(args?.body ?? ""),
          ...(head ? { head } : {}),
          ...(base ? { base } : {}),
          draft: args?.draft === true,
        },
      );
      const now = new Date().toISOString();
      return {
        number,
        title: String(args?.title ?? ""),
        state: "OPEN",
        author: { login: "" },
        createdAt: now,
        updatedAt: now,
        isDraft: args?.draft === true,
        reviewDecision: null,
        url,
        headRef: head,
        baseRef: base,
        additions: 0,
        deletions: 0,
      };
    },
    set_project_root: () => null,
    stop_watching: () => null,
  };

  return {
    handle(command, args) {
      const pathHandler = pathHandlers[command];
      if (pathHandler) {
        const path = relative(pathHandler.path(args));
        if (path !== null) return pathHandler.run(path, args);
        return base.handle(command, args);
      }
      const handler = handlers[command];
      if (handler) return handler(args);
      return base.handle(command, args);
    },
    seedStore: (path, values) => base.seedStore(path, values),
  };
}
