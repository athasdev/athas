import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker as Thread } from "node:worker_threads";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { createSearchWorkerSession } from "../services/search-worker-client";
import {
  captureSourceReplaceContext,
  replaceAllInSources,
  replaceNextInSource,
} from "../services/source-replace-service";
import { searchProviderFilesContent } from "../services/provider-content-search";
import type {
  ContentSearchTask,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "../workers/search-worker-protocol";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";

const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readText: io.read, writeText: io.write }),
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
let temporary: string;
let entry: string;
class BrowserWorkerThread {
  static instances: BrowserWorkerThread[] = [];
  static beforeReply: (() => void) | undefined;
  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  private thread: Thread;
  constructor() {
    this.thread = new Thread(pathToFileURL(entry));
    BrowserWorkerThread.instances.push(this);
    this.thread.on("message", (data: SearchWorkerResponse) => {
      BrowserWorkerThread.beforeReply?.();
      this.onmessage?.({ data } as MessageEvent<SearchWorkerResponse>);
    });
    this.thread.on("error", () => this.onerror?.({ preventDefault: () => {} } as ErrorEvent));
    this.thread.on("messageerror", () => this.onmessageerror?.());
  }
  postMessage(request: SearchWorkerRequest) {
    this.thread.postMessage(request);
  }
  terminate() {
    this.terminated = true;
    void this.thread.terminate();
  }
}
const options = { caseSensitive: true, wholeWord: false, useRegex: true };
const content = "a".repeat(40) + "!";
const task: ContentSearchTask = {
  kind: "search",
  filePath: "/w/a.ts",
  content,
  pattern: "^(a+)+$",
  flags: "g",
  contextLines: 2,
};
const owner = () => useBufferStore.getStore("owner");
beforeAll(() => {
  temporary = mkdtempSync(join(tmpdir(), "athas-search-worker-"));
  const bundle = join(temporary, "search-worker.mjs");
  execFileSync(
    "bun",
    [
      "build",
      fileURLToPath(new URL("../workers/search-worker.ts", import.meta.url)),
      "--target=browser",
      "--outfile",
      bundle,
    ],
    { stdio: "pipe" },
  );
  entry = join(temporary, "thread.mjs");
  writeFileSync(
    entry,
    `import { parentPort } from "node:worker_threads";
globalThis.self = {
  addEventListener: (type, listener) => parentPort.on(type, data => listener({ data })),
  postMessage: value => parentPort.postMessage(value),
};
await import(${JSON.stringify(pathToFileURL(bundle).href)});
`,
  );
});
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
beforeEach(() => {
  BrowserWorkerThread.instances = [];
  BrowserWorkerThread.beforeReply = undefined;
  vi.stubGlobal("Worker", BrowserWorkerThread);
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  io.read.mockReset().mockResolvedValue(content);
  io.write.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  for (const worker of BrowserWorkerThread.instances) {
    expect(worker.terminated).toBe(true);
    worker.terminate();
  }
  vi.unstubAllGlobals();
  workspaceRuntimeRegistry.resetForTests();
});
describe("actual search worker thread", () => {
  it("filters nested ignore rules in the bundled worker with precedence and escaped names", async () => {
    const client = createSearchWorkerSession();
    try {
      const result = await client.run({
        kind: "filter",
        filePath: "/w/src",
        entries: [
          { path: "src/keep.tmp", isDir: false },
          { path: "src/drop.tmp", isDir: false },
          { path: "src/#secret.ts", isDir: false },
          { path: "src/visible.ts", isDir: false },
          { path: "src/blocked", isDir: true },
        ],
        rules: [
          { directory: "", content: "*.tmp\n", kind: "gitignore" },
          { directory: "src", content: "!keep.tmp\n!#secret.ts\n", kind: "gitignore" },
          { directory: "", content: "src/blocked/\n", kind: "exclude" },
          { directory: "", content: "src/\\#secret.ts\n", kind: "ignore" },
        ],
      });
      expect(result).toEqual([0, 3]);
    } finally {
      client.dispose();
    }
  });
  it("keeps the parent responsive and terminates a pathological expression at the deadline", async () => {
    const client = createSearchWorkerSession();
    try {
      const started = Date.now();
      const result = expect(client.run(task)).rejects.toThrow("took too long");
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(Date.now() - started).toBeLessThan(2_000);
      await result;
      expect(Date.now() - started).toBeLessThan(8_000);
    } finally {
      client.dispose();
    }
  });
  it("cancels stuck matching and recovers in a fresh session with CRLF and UTF-16 ranges", async () => {
    const controller = new AbortController();
    const client = createSearchWorkerSession({ signal: controller.signal });
    try {
      const pending = expect(client.run(task)).rejects.toHaveProperty("name", "AbortError");
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      controller.abort();
      await pending;
    } finally {
      client.dispose();
    }
    const next = createSearchWorkerSession();
    try {
      const result = await next.run({ ...task, pattern: "foo", content: "before\r\n😀foo\rbye" });
      expect(result?.matches).toMatchObject([
        {
          line_number: 2,
          match_ranges: [{ start: 2, end: 5 }],
          context_before: ["before"],
          context_after: ["bye"],
        },
      ]);
    } finally {
      next.dispose();
    }
  });
  it("does not write any file when one replacement preflight times out", async () => {
    io.read.mockImplementation(async (path) => (path.endsWith("safe.ts") ? "aaa" : content));
    const result = expect(
      replaceAllInSources(["/w/safe.ts", "/w/stuck.ts"], "^(a+)+$", "new", options),
    ).rejects.toMatchObject({
      replacements: 0,
      editedFiles: 0,
      message: expect.stringContaining("took too long"),
    });
    await result;
    expect(io.write).not.toHaveBeenCalled();
  });
  it("cancels stuck replacement without writes and accepts a subsequent operation", async () => {
    const controller = new AbortController();
    const context = { ...captureSourceReplaceContext("owner"), signal: controller.signal };
    const pending = expect(
      replaceAllInSources([task.filePath], task.pattern, "new", options, context),
    ).rejects.toMatchObject({ editedFiles: 0, replacements: 0 });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await pending;
    expect(io.write).not.toHaveBeenCalled();
    io.read.mockResolvedValue("foo");
    expect(await replaceAllInSources([task.filePath], "foo", "new", options)).toBe(1);
    expect(io.write).toHaveBeenCalledExactlyOnceWith(task.filePath, "new", "foo");
  });
  it("reports a provider matching timeout as a failed search", async () => {
    await expect(
      searchProviderFilesContent({
        files: [{ name: "a.ts", path: task.filePath, isDir: false }],
        query: task.pattern,
        rootFolderPath: "/w",
        options,
        maxResults: 140,
        fileOffset: 0,
        contextLines: 2,
        includeQuery: "",
        excludeQuery: "",
        isCancelled: () => false,
      }),
    ).rejects.toThrow("took too long in /w/a.ts");
  });
  it("validates ten thousand displayed matches without repeatedly scanning the file", async () => {
    const client = createSearchWorkerSession();
    const lines = Array.from({ length: 10_000 }, () => "😀foo");
    try {
      const result = await client.run({
        kind: "replace",
        filePath: task.filePath,
        content: lines.join("\r\n"),
        pattern: "foo",
        flags: "gm",
        useRegex: true,
        replacement: "new",
        expectedMatches: lines.map((line, index) => ({
          line_number: index + 1,
          line_content: line,
          column_start: 2,
          column_end: 5,
          match_ranges: [{ start: 2, end: 5 }],
          context_before: [],
          context_after: [],
        })),
      });
      expect(result).toEqual({
        content: lines.map(() => "😀new").join("\r\n"),
        count: lines.length,
      });
    } finally {
      client.dispose();
    }
  });
  it.each(["all", "next"])("rejects a draft revised while %s matching is running", async (mode) => {
    owner().setState({
      buffers: [
        {
          id: "draft",
          type: "editor",
          path: task.filePath,
          name: "a.ts",
          content: "foo foo",
          savedContent: "foo foo",
          isDirty: false,
          isVirtual: false,
          language: "typescript",
        },
      ],
    });
    seedActiveBuffer("draft", "owner");
    const context = captureSourceReplaceContext("owner");
    BrowserWorkerThread.beforeReply = () => {
      owner().getState().actions.updateBufferContent("draft", "user edit", true);
    };
    const operation =
      mode === "all"
        ? replaceAllInSources([task.filePath], "foo", "new", options, context)
        : replaceNextInSource(
            { filePath: task.filePath, line: 1, column: 1 },
            "foo",
            "new",
            options,
            context,
          );
    const rejected = expect(operation).rejects.toThrow("changed while preparing");
    await rejected;
    expect(owner().getState().buffers[0]).toMatchObject({ content: "user edit", isDirty: true });
    expect(io.write).not.toHaveBeenCalled();
  });
  it("cancels provider matching in a retired view without reporting an empty successful result", async () => {
    let cancelled = false;
    const pending = searchProviderFilesContent({
      files: [{ name: "a.ts", path: task.filePath, isDir: false }],
      query: task.pattern,
      rootFolderPath: "/w",
      options,
      maxResults: 140,
      fileOffset: 0,
      contextLines: 2,
      includeQuery: "",
      excludeQuery: "",
      isCancelled: () => cancelled,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    cancelled = true;
    await expect(pending).resolves.toBeNull();
    expect(io.write).not.toHaveBeenCalled();
  });
  it("preserves capture groups and full-document replacement tokens across the thread", async () => {
    const client = createSearchWorkerSession();
    try {
      const result = await client.run({
        kind: "replace",
        filePath: task.filePath,
        content: "foobar foobar",
        pattern: "(?<name>foo)(?=bar)",
        flags: "gm",
        useRegex: true,
        replacement: "$<name>-$&-$$-$`-$'",
        target: { line: 1, column: 8 },
      });
      expect(result).toEqual({ content: "foobar foo-foo-$-foobar -barbar", count: 1 });
    } finally {
      client.dispose();
    }
  });
});
