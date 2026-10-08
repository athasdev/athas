import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useBufferStore } from "../stores/buffer.store";
import { useHistoryStore } from "../stores/history.store";
import {
  applyWorkspaceEdit,
  captureWorkspaceEditContext,
  WorkspaceEditFailure,
  type WorkspaceEdit,
} from "../lsp/workspace-edit";

const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), git: vi.fn() }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readText: io.read, writeText: io.write }),
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: io.git }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

function editor(path = "/p/a.ts", content = "alpha"): EditorContent {
  return {
    id: "same-id",
    type: "editor",
    path,
    name: "a.ts",
    content,
    savedContent: content,
    contentRevision: 0,
    isDirty: false,
    isVirtual: false,
    isPreview: false,
    isPinned: false,
    isActive: true,
    language: "typescript",
  };
}
const replace = (newText = "beta", start = 0, end = 5) => ({
  range: { start: { line: 0, character: start }, end: { line: 0, character: end } },
  newText,
});
const edit = (path = "/p/a.ts", newText = "beta"): WorkspaceEdit => ({
  changes: { [`file://${path}`]: [replace(newText)] },
});
const context = () => captureWorkspaceEditContext("owner");
const owner = () => useBufferStore.getStore("owner");
const current = () => owner().getState().buffers[0] as EditorContent;
const versioned = (version: number | null = 1): WorkspaceEdit => ({
  documentChanges: [{ textDocument: { uri: "file:///p/a.ts", version }, edits: [replace()] }],
});

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  owner().setState({ buffers: [editor()], activeBufferId: "same-id" });
  io.read.mockReset().mockResolvedValue("alpha");
  io.write.mockReset().mockResolvedValue(undefined);
  io.git.mockClear();
});
afterEach(() => workspaceRuntimeRegistry.resetForTests());

describe("owned workspace edit application", () => {
  it("accepts an empty workspace edit as a no-op", async () => {
    await expect(applyWorkspaceEdit({}, context())).resolves.toEqual({ editedFiles: 0 });
    expect(io.write).not.toHaveBeenCalled();
  });
  it("rechecks ownership even for an empty edit after native validation", async () => {
    const captured = context();
    captured.beforeApply = async () => {
      workspaceRuntimeRegistry.removeWorkspace("owner");
    };
    await expect(applyWorkspaceEdit({}, captured)).rejects.toThrow("owner");
  });
  it("edits a dirty open buffer and preserves its disk baseline and Undo", async () => {
    owner().setState({ buffers: [{ ...editor(), content: "alpha draft", isDirty: true }] });
    await expect(applyWorkspaceEdit(edit(), context())).resolves.toEqual({ editedFiles: 1 });
    expect(current()).toMatchObject({
      content: "beta draft",
      savedContent: "alpha",
      isDirty: true,
    });
    expect(io.write).not.toHaveBeenCalled();
    expect(
      useHistoryStore
        .getStore("owner")
        .getState()
        .actions.undo("same-id", { content: "beta draft", timestamp: 1 })?.content,
    ).toBe("alpha draft");
  });
  it("keeps edits and Undo in their captured workspace with identical buffer IDs", async () => {
    const captured = context();
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({ buffers: [editor()] });
    await applyWorkspaceEdit(edit(), captured);
    expect(current().content).toBe("beta");
    expect((useBufferStore.getState().buffers[0] as EditorContent).content).toBe("alpha");
    expect(useHistoryStore.getState().actions.canUndo("same-id")).toBe(false);
    expect(useHistoryStore.getStore("owner").getState().actions.canUndo("same-id")).toBe(true);
  });
  it.each(["readOnly", "isVirtual"] as const)(
    "rejects a %s buffer without disk writes",
    async (flag) => {
      owner().setState({ buffers: [{ ...editor(), [flag]: true }] });
      await expect(applyWorkspaceEdit(edit(), context())).rejects.toThrow("document changed");
      expect(io.write).not.toHaveBeenCalled();
      expect(current().content).toBe("alpha");
    },
  );
  it("rejects typing followed by Undo to the same text", async () => {
    const captured = context();
    owner().getState().actions.updateBufferContent("same-id", "newer", true);
    owner().getState().actions.updateBufferContent("same-id", "alpha", true);
    await expect(applyWorkspaceEdit(edit(), captured)).rejects.toThrow("document changed");
    expect(current().content).toBe("alpha");
  });
  it("rejects a retired and recreated workspace with the same ID", async () => {
    const captured = context();
    workspaceRuntimeRegistry.removeWorkspace("owner");
    workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Reopened" });
    owner().setState({ buffers: [editor()] });
    await expect(applyWorkspaceEdit(edit(), captured)).rejects.toThrow("owner");
    expect(current().content).toBe("alpha");
  });
  it("does not fall back to disk when the original open buffer closes", async () => {
    const captured = context();
    owner().setState({ buffers: [] });
    await expect(applyWorkspaceEdit(edit(), captured)).rejects.toThrow("document changed");
    expect(io.write).not.toHaveBeenCalled();
  });
  it.each([0, 2, undefined])(
    "rejects a mismatched or unavailable document version %s",
    async (version) => {
      const captured = context();
      captured.getDocumentVersion = () => version;
      await expect(applyWorkspaceEdit(versioned(), captured)).rejects.toMatchObject({
        failedChange: 0,
        editedFiles: 0,
      });
      expect(current().content).toBe("alpha");
    },
  );
  it("accepts null versions and prefers documentChanges over legacy changes", async () => {
    await applyWorkspaceEdit({ ...edit("/p/a.ts", "wrong"), ...versioned(null) }, context());
    expect(current().content).toBe("beta");
  });
  it("applies repeated document changes sequentially rather than flattening ranges", async () => {
    const captured = context();
    captured.getDocumentVersion = () => 1;
    await applyWorkspaceEdit(
      {
        documentChanges: [
          { textDocument: { uri: "file:///p/a.ts", version: 1 }, edits: [replace("z")] },
          { textDocument: { uri: "file:///p/a.ts", version: 2 }, edits: [replace("done", 0, 1)] },
        ],
      },
      captured,
    );
    expect(current().content).toBe("done");
    expect(
      useHistoryStore
        .getStore("owner")
        .getState()
        .actions.undo("same-id", { content: "done", timestamp: 1 })?.content,
    ).toBe("alpha");
  });
  it("rechecks document versions after asynchronous server validation", async () => {
    let version = 1;
    const captured = context();
    captured.getDocumentVersion = () => version;
    captured.beforeApply = async () => {
      version = 2;
    };
    await expect(applyWorkspaceEdit(versioned(), captured)).rejects.toThrow("version changed");
    expect(current().content).toBe("alpha");
  });
  it("validates every file before applying the first edit", async () => {
    await expect(
      applyWorkspaceEdit(
        {
          changes: {
            "file:///p/a.ts": [replace()],
            "file:///p/b.ts": [replace("bad", 4, 2)],
          },
        },
        context(),
      ),
    ).rejects.toThrow("reversed");
    expect(current().content).toBe("alpha");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("uses checked writes for unopened files and reports an external disk conflict", async () => {
    io.write.mockRejectedValue(new Error("Disk changed"));
    await expect(applyWorkspaceEdit(edit("/p/b.ts"), context())).rejects.toMatchObject({
      editedFiles: 0,
    });
    expect(io.write).toHaveBeenCalledExactlyOnceWith("/p/b.ts", "beta", "alpha");
    expect(io.git).not.toHaveBeenCalled();
  });
  it("stops at a failed interleaved operation before applying a later edit to the first file", async () => {
    io.write.mockRejectedValue(new Error("Disk changed"));
    const failed = applyWorkspaceEdit(
      {
        documentChanges: [
          { textDocument: { uri: "file:///p/a.ts", version: null }, edits: [replace("z")] },
          { textDocument: { uri: "file:///p/b.ts", version: null }, edits: [replace()] },
          {
            textDocument: { uri: "file:///p/a.ts", version: null },
            edits: [replace("done", 0, 1)],
          },
        ],
      },
      context(),
    );
    await expect(failed).rejects.toMatchObject({ failedChange: 1, editedFiles: 1 });
    expect(current().content).toBe("z");
  });
  it("writes interleaved unopened documents in protocol order with each staged baseline", async () => {
    const result = await applyWorkspaceEdit(
      {
        documentChanges: [
          { textDocument: { uri: "file:///p/b.ts", version: null }, edits: [replace("z")] },
          { textDocument: { uri: "file:///p/c.ts", version: null }, edits: [replace("other")] },
          {
            textDocument: { uri: "file:///p/b.ts", version: null },
            edits: [replace("done", 0, 1)],
          },
        ],
      },
      context(),
    );
    expect(result.editedFiles).toBe(2);
    expect(io.write.mock.calls).toEqual([
      ["/p/b.ts", "z", "alpha"],
      ["/p/c.ts", "other", "alpha"],
      ["/p/b.ts", "done", "z"],
    ]);
  });
  it("reports the original failedChange and completed edits when a later write fails", async () => {
    io.write.mockRejectedValue(new Error("Disk changed"));
    const failure = await applyWorkspaceEdit(
      {
        documentChanges: [
          { textDocument: { uri: "file:///p/a.ts", version: null }, edits: [replace()] },
          { textDocument: { uri: "file:///p/b.ts", version: null }, edits: [replace()] },
        ],
      },
      context(),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkspaceEditFailure);
    expect(failure).toMatchObject({ editedFiles: 1, failedChange: 1 });
    expect(String(failure)).toContain("already changed");
    expect(current().content).toBe("beta");
  });
  it("rejects a new dirty buffer opened during preparation", async () => {
    io.read.mockImplementation(async () => {
      owner().setState({
        buffers: [{ ...editor("/p/b.ts"), content: "new draft", isDirty: true }],
      });
      return "alpha";
    });
    await expect(applyWorkspaceEdit(edit("/p/b.ts"), context())).rejects.toThrow(
      "document changed",
    );
    expect(io.write).not.toHaveBeenCalled();
  });
  it("updates a buffer opened during the disk write without replacing newer typing", async () => {
    io.write.mockImplementation(async () => {
      owner().setState({
        buffers: [{ ...editor("/p/b.ts"), content: "new draft", isDirty: true }],
      });
    });
    await applyWorkspaceEdit(edit("/p/b.ts"), context());
    expect(current()).toMatchObject({ content: "new draft", savedContent: "beta", isDirty: true });
  });
  it("notifies an originating-document guard after its own edit before editing another file", async () => {
    const captured = context();
    let expected = "alpha";
    captured.isCurrent = () => current().content === expected;
    captured.onBufferApplied = (buffer) => {
      expected = buffer.content;
    };
    await expect(
      applyWorkspaceEdit(
        { changes: { "file:///p/a.ts": [replace()], "file:///p/b.ts": [replace()] } },
        captured,
      ),
    ).resolves.toEqual({ editedFiles: 2 });
    expect(current().content).toBe("beta");
    expect(io.write).toHaveBeenCalledOnce();
  });
  it("matches Windows separator aliases without altering POSIX backslashes", async () => {
    owner().setState({ buffers: [editor("c:\\work\\a.ts")] });
    await applyWorkspaceEdit(edit("/C:/work/a.ts"), context());
    expect(current().content).toBe("beta");
    expect(io.write).not.toHaveBeenCalled();
  });
  it.each([
    "untitled:test",
    "https://example.com/a.ts",
    "file:///p/a.ts?query",
    "file:///p/%00.ts",
    "file:///p/%xx.ts",
  ])("rejects unsupported file identity %s", async (uri) => {
    await expect(
      applyWorkspaceEdit({ changes: { [uri]: [replace()] } }, context()),
    ).rejects.toThrow();
    expect(io.write).not.toHaveBeenCalled();
  });
  it("recovers its queue after a failed edit and rejects a second stale edit", async () => {
    const captured = context();
    const first = applyWorkspaceEdit(edit(), captured);
    const second = applyWorkspaceEdit(edit("/p/a.ts", "stale"), captured);
    await first;
    await expect(second).rejects.toThrow("document changed");
    await applyWorkspaceEdit(edit("/p/a.ts", "fresh"), context());
    expect(current().content).toBe("fresh");
  });
});
