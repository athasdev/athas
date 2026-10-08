import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useHistoryStore } from "@/features/editor/stores/history.store";
import {
  captureSourceReplaceContext,
  replaceAllInSources,
  replaceNextInSource,
  SourceReplaceFailure,
} from "../services/source-replace-service";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
vi.mock("../services/search-worker-client", async () => {
  const { executeSearchTask } = await import("../workers/search-worker-execution");
  return {
    createSearchWorkerSession: () => ({
      run: async (task: Parameters<typeof executeSearchTask>[0]) => executeSearchTask(task),
      dispose: () => {},
    }),
  };
});
const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), git: vi.fn() }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readText: io.read, writeText: io.write }),
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: io.git }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
const options = { caseSensitive: true, wholeWord: false, useRegex: true };
const path = "/w/a.ts";
function editor(filePath = path, content = "foobar foobar"): EditorContent {
  return {
    id: "same-id",
    type: "editor",
    path: filePath,
    name: "a.ts",
    content,
    savedContent: "disk baseline",
    isDirty: true,
    isVirtual: false,
    language: "typescript",
  };
}
const owner = () => useBufferStore.getStore("owner");
const current = () => owner().getState().buffers[0] as EditorContent;
const context = () => captureSourceReplaceContext("owner");
function replace(query = "foo", replacement = "new", paths = [path]) {
  return replaceAllInSources(paths, query, replacement, options);
}
function target(column = 1, line = 1) {
  return { filePath: path, line, column };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  owner().setState({ buffers: [editor()] });
  seedActiveBuffer("same-id", "owner");
  io.read.mockReset().mockResolvedValue("foobar");
  io.write.mockReset().mockResolvedValue(undefined);
  io.git.mockClear();
});
afterEach(() => workspaceRuntimeRegistry.resetForTests());

describe("source replacement", () => {
  it.each(["foo(?=bar)", "(?<=foo)bar"])("preserves full context for %s", async (query) => {
    expect(await replace(query)).toBe(2);
    expect(current().content).toBe(query.startsWith("foo") ? "newbar newbar" : "foonew foonew");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("replaces only the selected occurrence with full regex context", async () => {
    expect(await replaceNextInSource(target(8), "foo(?=bar)", "$&!", options)).toBe(true);
    expect(current().content).toBe("foobar foo!bar");
  });
  it("uses capture groups and native replacement tokens", async () => {
    await replace("(?<name>foo)(bar)", "$<name>-$2-$$");
    expect(current().content).toBe("foo-bar-$ foo-bar-$");
  });
  it("treats replacement dollar tokens literally outside regex mode", async () => {
    await replaceAllInSources([path], "foo", "$&", { ...options, useRegex: false });
    expect(current().content).toBe("$&bar $&bar");
  });
  it("deduplicates paths and retains one Undo step with the saved baseline", async () => {
    expect(await replace("foo", "new", [path, path])).toBe(2);
    expect(current().savedContent).toBe("disk baseline");
    const actions = useHistoryStore.getStore("owner").getState().actions;
    expect(actions.undo("same-id", { content: current().content, timestamp: 1 })?.content).toBe(
      "foobar foobar",
    );
    expect(actions.undo("same-id", { content: "foobar foobar", timestamp: 1 })).toBeNull();
  });
  it("rejects a read-only editor before any write", async () => {
    owner().setState({ buffers: [{ ...editor(), readOnly: true }] });
    await expect(replace()).rejects.toThrow("read-only");
    expect(current().content).toBe("foobar foobar");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("does not write through a virtual editor", async () => {
    owner().setState({ buffers: [{ ...editor(), isVirtual: true }] });
    await expect(replace()).rejects.toThrow("not an editable source");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("preserves edits typed while preparing replacement", async () => {
    const pending = replace();
    owner().getState().actions.updateBufferContent("same-id", "typed meanwhile", true);
    await expect(pending).rejects.toThrow("changed while preparing");
    expect(current().content).toBe("typed meanwhile");
  });
  it("rejects typing followed by Undo to the original text", async () => {
    const pending = replace();
    owner().getState().actions.updateBufferContent("same-id", "newer", true);
    owner().getState().actions.updateBufferContent("same-id", "foobar foobar", true);
    await expect(pending).rejects.toThrow("changed while preparing");
    expect(current().content).toBe("foobar foobar");
  });
  it("keeps replacement and Undo in the original workspace with identical IDs", async () => {
    const captured = context();
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({ buffers: [editor()] });
    expect(await replaceAllInSources([path], "foo", "new", options, captured)).toBe(2);
    expect(current().content).toBe("newbar newbar");
    expect((useBufferStore.getState().buffers[0] as EditorContent).content).toBe("foobar foobar");
    expect(useHistoryStore.getState().actions.canUndo("same-id")).toBe(false);
  });
  it("keeps a closed-file read in its owner after switching workspaces", async () => {
    owner().setState({ buffers: [] });
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const pending = replace();
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledOnce());
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({ buffers: [editor()] });
    read.resolve("foobar");
    expect(await pending).toBe(1);
    expect(io.write).toHaveBeenCalledExactlyOnceWith(path, "newbar", "foobar");
    expect((useBufferStore.getState().buffers[0] as EditorContent).content).toBe("foobar foobar");
  });
  it("rejects a removed and recreated owner after a delayed read", async () => {
    owner().setState({ buffers: [] });
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const pending = replace();
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledOnce());
    workspaceRuntimeRegistry.removeWorkspace("owner");
    workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Reopened" });
    owner().setState({ buffers: [editor()] });
    read.resolve("foobar");
    await expect(pending).rejects.toThrow("no longer available");
    expect(io.write).not.toHaveBeenCalled();
    expect(current().content).toBe("foobar foobar");
  });
  it("rejects a closed original buffer without falling back to disk", async () => {
    const pending = replace();
    owner().setState({ buffers: [] });
    await expect(pending).rejects.toThrow("was closed");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("does not overwrite a dirty buffer opened during a disk read", async () => {
    owner().setState({ buffers: [] });
    const read = deferred<string>();
    io.read.mockReturnValueOnce(read.promise);
    const pending = replace();
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledOnce());
    owner().setState({ buffers: [editor()] });
    read.resolve("foobar");
    await expect(pending).rejects.toThrow("changed while preparing");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("updates the committed baseline without discarding a draft opened during the write", async () => {
    owner().setState({ buffers: [] });
    io.write.mockImplementation(async () =>
      owner().setState({ buffers: [{ ...editor(), content: "typed", savedContent: "foobar" }] }),
    );
    expect(await replace()).toBe(1);
    expect(current()).toMatchObject({ content: "typed", savedContent: "newbar", isDirty: true });
  });
  it("writes closed remote resources through checked providers and refreshes Git", async () => {
    owner().setState({ buffers: [] });
    const remote = "remote://server/repo/a.ts";
    expect(await replace("foo", "new", [remote])).toBe(1);
    expect(io.write).toHaveBeenCalledExactlyOnceWith(remote, "newbar", "foobar");
    expect(io.git).toHaveBeenCalledWith(expect.objectContaining({ filePath: remote }));
  });
  it("stages every file before mutation and leaves all files unchanged on a read error", async () => {
    io.read.mockRejectedValueOnce(new Error("Missing file"));
    await expect(replace("foo", "new", [path, "/w/b.ts"])).rejects.toMatchObject({
      editedFiles: 0,
      replacements: 0,
    });
    expect(current().content).toBe("foobar foobar");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("reports exact completed replacements and files after a later checked write fails", async () => {
    io.write.mockRejectedValueOnce(new Error("Disk changed"));
    const failure = await replace("foo", "new", [path, "/w/b.ts"]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SourceReplaceFailure);
    expect(failure).toMatchObject({ replacements: 2, editedFiles: 1, filePath: "/w/b.ts" });
    expect(String(failure)).toContain("before stopping");
    expect(current().content).toBe("newbar newbar");
  });
  it("stops later writes after cancellation while counting an already completed write", async () => {
    owner().setState({ buffers: [] });
    const controller = new AbortController();
    const captured = context();
    captured.signal = controller.signal;
    io.write.mockImplementationOnce(async () => controller.abort());
    await expect(
      replaceAllInSources([path, "/w/b.ts"], "foo", "new", options, captured),
    ).rejects.toMatchObject({ replacements: 1, editedFiles: 1 });
    expect(io.write).toHaveBeenCalledOnce();
  });
  it("rejects replacement in a disposed search view", async () => {
    const captured = context();
    captured.isCurrent = () => false;
    await expect(replaceAllInSources([path], "foo", "new", options, captured)).rejects.toThrow(
      "no longer available",
    );
    expect(current().content).toBe("foobar foobar");
  });
  it("recovers the workspace queue after failure and rejects a second stale edit", async () => {
    const captured = context();
    const first = replaceAllInSources([path], "foo", "new", options, captured);
    const second = replaceAllInSources([path], "foo", "stale", options, captured);
    await first;
    await expect(second).rejects.toThrow("changed while preparing");
    expect(await replace("new", "fresh")).toBe(2);
    expect(current().content).toBe("freshbar freshbar");
  });
  it("handles zero-width matches and does not count unchanged replacements", async () => {
    expect(await replace("(?=foo)", "!")).toBe(2);
    expect(current().content).toBe("!foobar !foobar");
    expect(await replaceNextInSource(target(2), "foo", "$&", options)).toBe(false);
  });
  it("replaces an adjacent selected occurrence rather than the preceding match", async () => {
    owner().setState({ buffers: [editor(path, "foofoo")] });
    await replaceNextInSource(target(4), "foo", "new", options);
    expect(current().content).toBe("foonew");
  });
  it("does not jump to another occurrence when the selected position is stale", async () => {
    expect(await replaceNextInSource(target(6), "foo", "new", options)).toBe(false);
    expect(current().content).toBe("foobar foobar");
  });
  it("rejects a changed search-result line before replacing", async () => {
    await expect(
      replaceNextInSource({ ...target(), expectedLine: "old line" }, "foo", "new", options),
    ).rejects.toThrow("selected search match changed");
    expect(current().content).toBe("foobar foobar");
  });
  it("uses UTF-16 columns and CRLF line offsets", async () => {
    owner().setState({ buffers: [editor(path, "first\r\n😀foo\r\nfoo")] });
    await replaceNextInSource(target(3, 2), "foo", "new", options);
    expect(current().content).toBe("first\r\n😀new\r\nfoo");
  });
  it("uses line anchors consistently when replacing search results", async () => {
    owner().setState({ buffers: [editor(path, "foo\nfoo\nother")] });
    expect(await replace("^foo$", "new")).toBe(2);
    expect(current().content).toBe("new\nnew\nother");
  });
  it("rejects extra matches introduced after the displayed search snapshot", async () => {
    const captured = context();
    captured.expectedMatches = new Map([
      [
        path,
        [
          {
            line_number: 1,
            line_content: "foobar foobar",
            column_start: 0,
            column_end: 3,
            match_ranges: [{ start: 0, end: 3 }],
          },
        ],
      ],
    ]);
    await expect(replaceAllInSources([path], "foo", "new", options, captured)).rejects.toThrow(
      "replacement expression differ",
    );
    expect(current().content).toBe("foobar foobar");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("applies exactly the displayed match ranges and validates their line snapshot", async () => {
    const captured = context();
    captured.expectedMatches = new Map([
      [
        path,
        [
          {
            line_number: 1,
            line_content: "foobar foobar",
            column_start: 0,
            column_end: 3,
            match_ranges: [
              { start: 0, end: 3 },
              { start: 7, end: 10 },
            ],
          },
        ],
      ],
    ]);
    expect(await replaceAllInSources([path], "foo", "new", options, captured)).toBe(2);
    expect(current().content).toBe("newbar newbar");
  });
  it("rejects a changed result line before applying any of its replacements", async () => {
    const captured = context();
    captured.expectedMatches = new Map([
      [path, [{ line_number: 1, line_content: "old line", column_start: 0, column_end: 3 }]],
    ]);
    await expect(replaceAllInSources([path], "foo", "new", options, captured)).rejects.toThrow(
      "changed since the search",
    );
    expect(io.write).not.toHaveBeenCalled();
    expect(current().content).toBe("foobar foobar");
  });
  it("validates zero-width matches against the displayed ranges", async () => {
    const captured = context();
    captured.expectedMatches = new Map([
      [
        path,
        [
          {
            line_number: 1,
            line_content: "foobar foobar",
            column_start: 0,
            column_end: 0,
            match_ranges: [
              { start: 0, end: 0 },
              { start: 7, end: 7 },
            ],
          },
        ],
      ],
    ]);
    expect(await replaceAllInSources([path], "(?=foo)", "!", options, captured)).toBe(2);
    expect(current().content).toBe("!foobar !foobar");
  });
  it("returns no changes for invalid regexes", async () => {
    expect(await replace("[", "new")).toBe(0);
    expect(io.write).not.toHaveBeenCalled();
  });
});
