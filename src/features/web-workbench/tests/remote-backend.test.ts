import { describe, expect, it, vi } from "vite-plus/test";
import { MemoryFileSystem } from "@/features/web-workbench/services/memory-file-system";
import { MemoryGitRepository } from "@/features/web-workbench/services/memory-git";
import { createRemoteBackend } from "@/features/web-workbench/services/remote-backend";
import { createWebBackend } from "@/features/web-workbench/services/web-backend";
import type { WorkspaceTransport } from "@/features/web-workbench/services/workspace-connection";
import {
  bytesToBase64,
  parseUnifiedPatch,
  type WorkspaceEvent,
} from "@/features/web-workbench/services/workspace-protocol";

const ROOT = "/workspace/athas";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fakeTransport(answers: Record<string, (params: Record<string, any>) => unknown> = {}) {
  const calls: Array<{ method: string; params: Record<string, any> }> = [];
  const eventListeners = new Set<(event: WorkspaceEvent) => void>();
  const outputListeners = new Set<(id: string, data: Uint8Array) => void>();
  const transport: WorkspaceTransport = {
    call: async <T>(method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (!answer) return {} as T;
      return (await answer(params)) as T;
    },
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onTerminalOutput: (listener) => {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
  };
  return {
    transport,
    calls,
    event: (event: WorkspaceEvent) => eventListeners.forEach((listener) => listener(event)),
    output: (id: string, text: string) =>
      outputListeners.forEach((listener) => listener(id, encoder.encode(text))),
  };
}

function setup(answers?: Parameters<typeof fakeTransport>[0]) {
  const home = "/root";
  const fs = new MemoryFileSystem(home, { ".athas/settings.json": "{}" });
  const base = createWebBackend({
    home,
    fs,
    git: new MemoryGitRepository(fs, home, { branch: "main", head: {} }),
    appVersion: "1.0.0",
  });
  const fake = fakeTransport(answers);
  const emit = vi.fn();
  const backend = createRemoteBackend({ base, transport: fake.transport, root: ROOT, emit });
  const invoke = async (command: string, args?: Record<string, unknown>) =>
    backend.handle(command, args);
  return { ...fake, emit, backend, invoke };
}

function channel() {
  const messages: unknown[] = [];
  return { messages, onmessage: (message: unknown) => void messages.push(message) };
}

describe("remote backend: files", () => {
  it("sends workspace paths to the workspace API, relative to the root", async () => {
    const { invoke, calls } = setup({
      "fs.read": () => ({ content: bytesToBase64(encoder.encode("hello")) }),
      "fs.readdir": () => ({
        entries: [
          { name: "README.md", type: "file" },
          { name: "src", type: "directory" },
        ],
      }),
      "fs.stat": () => ({ type: "file", size: 5, mode: 0o100644, mtime: 7 }),
      "fs.exists": () => ({ exists: true }),
    });
    const bytes = (await invoke("read_local_file", { path: `${ROOT}/README.md` })) as number[];
    expect(decoder.decode(new Uint8Array(bytes))).toBe("hello");
    expect(await invoke("plugin:fs|read_dir", { path: ROOT })).toEqual([
      { name: "src", isDirectory: true, isFile: false, isSymlink: false },
      { name: "README.md", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    expect(await invoke("plugin:fs|stat", { path: `${ROOT}/README.md` })).toMatchObject({
      isFile: true,
      size: 5,
      mtime: 7,
    });
    expect(await invoke("plugin:fs|exists", { path: `file://${ROOT}/a.ts` })).toBe(true);
    await invoke("write_local_file_checked", {
      path: `${ROOT}/src/a.ts`,
      content: "x",
      expected: { byteLength: 3 },
    });
    await invoke("rename_file", { sourcePath: `${ROOT}/a.ts`, targetPath: `${ROOT}/b.ts` });
    await invoke("delete_local_file_checked", { path: `${ROOT}/b.ts`, expectedContent: "y" });
    await invoke("plugin:fs|mkdir", { path: `${ROOT}/docs`, options: { recursive: true } });
    expect(calls).toEqual([
      { method: "fs.read", params: { path: "README.md" } },
      { method: "fs.readdir", params: { path: "" } },
      { method: "fs.stat", params: { path: "README.md" } },
      { method: "fs.exists", params: { path: "a.ts" } },
      {
        method: "fs.write",
        params: { path: "src/a.ts", content: bytesToBase64(encoder.encode("x")), expectedSize: 3 },
      },
      { method: "fs.rename", params: { from: "a.ts", to: "b.ts" } },
      {
        method: "fs.remove",
        params: {
          path: "b.ts",
          recursive: true,
          expectedContent: bytesToBase64(encoder.encode("y")),
        },
      },
      { method: "fs.mkdir", params: { path: "docs", recursive: true } },
    ]);
  });

  it("keeps app data, settings and other paths outside the workspace in memory", async () => {
    const { invoke, calls } = setup();
    expect(await invoke("plugin:fs|exists", { path: "/root/.athas/settings.json" })).toBe(true);
    expect(await invoke("plugin:fs|read_dir", { path: "/root/missing" })).toEqual([]);
    const rid = await invoke("plugin:store|load", { path: "settings.json" });
    await invoke("plugin:store|set", { rid, key: "theme", value: "athas-dark" });
    expect(await invoke("plugin:store|get", { rid, key: "theme" })).toEqual(["athas-dark", true]);
    expect(await invoke("plugin:fs|exists", { path: "/workspace/athas-other/x" })).toBe(false);
    expect(calls).toEqual([]);
  });

  it("turns watcher batches into workspace file change events", async () => {
    const { event, emit, invoke, calls } = setup({ "fs.list": () => ({ files: ["a.ts"] }) });
    await invoke("fff_list_files", { rootPaths: [ROOT] });
    event({
      type: "fs.changes",
      changes: [
        { path: "src/new.ts", kind: "created", isDir: false },
        { path: "src", kind: "modified", isDir: true },
      ],
      gitChanged: true,
      rescan: false,
    });
    expect(emit).toHaveBeenCalledWith("workspace-file-changes", {
      root: ROOT,
      changes: [
        { path: `${ROOT}/src/new.ts`, kind: "created", is_dir: false },
        { path: `${ROOT}/src`, kind: "modified", is_dir: true },
      ],
      git_changed: true,
      rescan: false,
    });
    // A created file invalidates the quick open list.
    await invoke("fff_list_files", { rootPaths: [ROOT] });
    expect(calls.filter((call) => call.method === "fs.list")).toHaveLength(2);
  });
});

describe("remote backend: quick open and search", () => {
  it("lists and fuzzy matches the workspace's files once", async () => {
    const { invoke, calls } = setup({
      "fs.list": () => ({ files: ["src/app/page.tsx", "README.md"] }),
    });
    expect(await invoke("fff_list_files", { rootPaths: [ROOT] })).toEqual([
      { path: `${ROOT}/src/app/page.tsx`, name: "page.tsx", relative_path: "src/app/page.tsx" },
      { path: `${ROOT}/README.md`, name: "README.md", relative_path: "README.md" },
    ]);
    const hits = (await invoke("fff_search_files", { query: "page", limit: 5 })) as Array<{
      relative_path: string;
    }>;
    expect(hits.map((hit) => hit.relative_path)).toEqual(["src/app/page.tsx"]);
    expect(await invoke("fff_scan_status", { rootPaths: [ROOT] })).toMatchObject({
      indexed_files: 2,
      is_scanning: false,
    });
    expect(calls.filter((call) => call.method === "fs.list")).toHaveLength(1);
  });

  it("streams content search results and a summary over the channel", async () => {
    const { invoke, calls } = setup({
      "search.content": () => ({
        results: [
          {
            path: "src/a.ts",
            matches: [
              {
                line: 3,
                text: "const needle = 1;",
                ranges: [{ start: 6, end: 12 }],
                before: [],
                after: [],
              },
            ],
          },
        ],
        truncated: true,
      }),
    });
    const events = channel();
    await invoke("search_files_content_stream", {
      request: {
        search_id: "s1",
        root_paths: [ROOT],
        query: "needle",
        case_sensitive: true,
        whole_word: false,
        use_regex: false,
        max_results: 100,
        file_offset: null,
        context_lines: 1,
      },
      onEvent: events,
    });
    expect(calls[0]).toEqual({
      method: "search.content",
      params: {
        query: "needle",
        regex: false,
        caseSensitive: true,
        wholeWord: false,
        maxResults: 100,
        contextLines: 1,
      },
    });
    expect(events.messages).toEqual([
      {
        kind: "results",
        results: [
          {
            file_path: `${ROOT}/src/a.ts`,
            total_matches: 1,
            matches: [
              {
                line_number: 3,
                line_content: "const needle = 1;",
                column_start: 6,
                column_end: 12,
                match_ranges: [{ start: 6, end: 12 }],
                context_before: [],
                context_after: [],
              },
            ],
          },
        ],
        searched_files: 1,
        searchable_files: 1,
      },
      expect.objectContaining({
        kind: "done",
        summary: expect.objectContaining({ has_more: true }),
      }),
    ]);
  });
});

describe("remote backend: terminals", () => {
  it("creates a terminal in the workspace and routes its output and exit to the channel", async () => {
    const { invoke, calls, output, event } = setup({ "terminal.create": () => ({ id: "t1" }) });
    const events = channel();
    const createPromise = invoke("create_terminal", {
      config: {
        workingDirectory: `${ROOT}/src`,
        shell: "bash",
        size: { rows: 30, cols: 100, pixelWidth: 0, pixelHeight: 0 },
        environment: { FOO: "1" },
        command: null,
        args: null,
      },
      onEvent: events,
      windowLabel: "main",
      frontendSessionId: "s",
    });
    // Output can arrive before the create call answers.
    output("t1", "$ ");
    expect(await createPromise).toBe("t1");
    output("t1", "ls\r\n");
    expect(events.messages.map((message) => decoder.decode(message as ArrayBuffer))).toEqual([
      "$ ",
      "ls\r\n",
    ]);
    expect(calls[0]).toEqual({
      method: "terminal.create",
      params: { cols: 100, rows: 30, cwd: "src", env: { FOO: "1" } },
    });

    await invoke("terminal_write", { id: "t1", input: { kind: "text", data: "pwd\r" } });
    await invoke("terminal_write", { id: "t1", input: { kind: "binary", data: [3] } });
    await invoke("terminal_resize", { id: "t1", size: { rows: 40, cols: 120 } });
    await invoke("terminal_set_paused", { id: "t1", paused: true });
    expect(calls.slice(1)).toEqual([
      { method: "terminal.write", params: { id: "t1", data: "pwd\r" } },
      { method: "terminal.write", params: { id: "t1", bytes: "Aw==" } },
      { method: "terminal.resize", params: { id: "t1", cols: 120, rows: 40 } },
      { method: "terminal.pause", params: { id: "t1", paused: true } },
    ]);

    event({ type: "terminal.exit", id: "t1", exitCode: 0 });
    expect(events.messages[events.messages.length - 1]).toEqual({
      event: "exit",
      exitCode: 0,
      signal: null,
    });
    expect(await invoke("list_shells")).toEqual([expect.objectContaining({ id: "bash" })]);
  });

  it("reattaches surviving terminals after a reconnect and closes the rest", async () => {
    let next = 1;
    const { invoke, calls, event } = setup({ "terminal.create": () => ({ id: `t${next++}` }) });
    const first = channel();
    const second = channel();
    const size = { rows: 24, cols: 80 };
    await invoke("create_terminal", { config: { size }, onEvent: first });
    await invoke("create_terminal", { config: { size }, onEvent: second });
    event({
      type: "reconnected",
      workspace: {
        id: "w",
        repo: "a/b",
        branch: "main",
        root: ROOT,
        terminals: ["t1"],
        stopsAt: 0,
      },
    });
    expect(calls[calls.length - 1]).toEqual({ method: "terminal.attach", params: { id: "t1" } });
    expect(second.messages).toEqual([{ event: "closed" }]);
  });
});

describe("remote backend: git", () => {
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    " keep",
    "-old",
    "+new",
    "diff --git a/new.ts b/new.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.ts",
    "@@ -0,0 +1 @@",
    "+hello",
    "",
  ].join("\n");

  it("maps status, staging, commits and branches to the git CLI methods", async () => {
    const { invoke, calls } = setup({
      "git.status": () => ({
        branch: "main",
        head: "abc",
        upstream: null,
        ahead: 1,
        behind: 0,
        files: [{ path: "a.ts", status: "modified", staged: false }],
      }),
      "git.log": () => ({ commits: [{ hash: "abc", message: "Init" }] }),
      "git.branches": () => ({ current: "main", local: ["main", "dev"], remote: ["origin/main"] }),
    });
    expect(await invoke("git_discover_repo", { path: `${ROOT}/src` })).toBe(ROOT);
    expect(await invoke("git_discover_repo", { path: "/root" })).toBeNull();
    expect(await invoke("git_status", { repoPath: ROOT })).toEqual({
      branch: "main",
      ahead: 1,
      behind: 0,
      files: [{ path: "a.ts", status: "modified", staged: false }],
    });
    await invoke("git_add", { repoPath: ROOT, filePath: "a.ts" });
    await invoke("git_reset", { repoPath: ROOT, filePath: `${ROOT}/a.ts` });
    await invoke("git_commit", { repoPath: ROOT, message: "Fix" });
    expect(await invoke("git_log", { repoPath: ROOT, limit: 10, skip: 0 })).toEqual([
      { hash: "abc", message: "Init" },
    ]);
    expect(await invoke("git_branches", { repoPath: ROOT })).toEqual(["main", "dev"]);
    await invoke("git_create_branch", { repoPath: ROOT, branchName: "feature", fromBranch: null });
    await invoke("git_push", { repoPath: ROOT, branch: null, remote: "origin" });
    expect(calls.map((call) => [call.method, call.params])).toEqual([
      ["git.status", {}],
      ["git.add", { paths: ["a.ts"] }],
      ["git.reset", { paths: ["a.ts"] }],
      ["git.commit", { message: "Fix" }],
      ["git.log", { limit: 10, skip: 0 }],
      ["git.branches", {}],
      ["git.checkout", { branch: "feature", create: true }],
      ["git.push", {}],
    ]);
  });

  it("turns patches into the diff views' lines and stats", async () => {
    const { invoke } = setup({
      "git.diff": (params) => ({ patch: params.staged ? "" : patch }),
    });
    const diff = (await invoke("git_diff_file", {
      repoPath: ROOT,
      filePath: "src/a.ts",
      staged: false,
    })) as {
      lines: Array<{ line_type: string; content: string }>;
      additions: number;
    };
    expect(diff.lines.map((line) => `${line.line_type}:${line.content}`)).toEqual([
      "header:@@ -1,2 +1,2 @@",
      "context:keep",
      "removed:old",
      "added:new",
    ]);
    expect(diff.additions).toBe(1);
    expect(await invoke("git_status_diff_stats", { repoPath: ROOT })).toEqual([
      { file_path: "src/a.ts", staged: false, additions: 1, deletions: 1 },
      { file_path: "new.ts", staged: false, additions: 1, deletions: 0 },
    ]);
  });

  it("opens pull requests through the workspace's GitHub method", async () => {
    const { invoke, calls } = setup({
      "github.createPullRequest": () => ({ url: "https://github.com/a/b/pull/4", number: 4 }),
    });
    expect(
      await invoke("github_create_pull_request", {
        repoPath: ROOT,
        title: "Fix",
        body: "Body",
        head: "feature",
        base: "main",
        draft: true,
        labels: [],
        assignees: [],
      }),
    ).toMatchObject({
      number: 4,
      url: "https://github.com/a/b/pull/4",
      isDraft: true,
      headRef: "feature",
    });
    expect(calls[0]).toEqual({
      method: "github.createPullRequest",
      params: { title: "Fix", body: "Body", head: "feature", base: "main", draft: true },
    });
  });

  it("parses new and deleted files in patches", () => {
    const [changed, added] = parseUnifiedPatch(patch);
    expect(changed).toMatchObject({ path: "src/a.ts", isNew: false, additions: 1, deletions: 1 });
    expect(added).toMatchObject({ path: "new.ts", isNew: true, oldPath: null });
    expect(added.lines[1]).toEqual({
      line_type: "added",
      content: "hello",
      old_line_number: null,
      new_line_number: 1,
    });
  });
});
