import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { LspClient } from "../lsp/lsp-client";
import type { WorkspaceEditContext } from "../lsp/workspace-edit";
import { useBufferStore } from "../stores/buffer.store";
const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readText: io.read, writeText: io.write }),
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: vi.fn() }));
const path = "/p/a.ts";
function buffer(): EditorContent {
  return {
    id: "a",
    type: "editor",
    path,
    name: "a.ts",
    content: "alpha",
    savedContent: "alpha",
    isDirty: false,
    isVirtual: false,
    isPreview: false,
    isPinned: false,
    isActive: true,
    language: "typescript",
  };
}
const replacement = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
  newText: "beta",
};
const edit = { changes: { "file:///p/a.ts": [replacement] } };
const client = LspClient.getInstance();
const boundary = client as unknown as {
  registerWorkspaceEditOwner(path: string): { context: WorkspaceEditContext; token: string };
  activateWorkspaceEditOwner(path: string, token: string, context: WorkspaceEditContext): void;
  applyServerWorkspaceEdit(request: {
    clientId: string;
    requestId: number;
    ownerToken: string;
    edit: unknown;
  }): Promise<void>;
  documentVersions: Map<string, number>;
  documentChangeQueues: Map<string, unknown[]>;
  documentChangeSendsPending: Set<string>;
};
const owner = () => useBufferStore.getStore("owner");
const content = () => (owner().getState().buffers[0] as EditorContent).content;
function register(root = "/p") {
  const owned = boundary.registerWorkspaceEditOwner(root);
  boundary.activateWorkspaceEditOwner(root, owned.token, owned.context);
  return owned.token;
}
function request(token: string, changes: unknown = edit) {
  return boundary.applyServerWorkspaceEdit({
    clientId: "native-client",
    requestId: 42,
    ownerToken: token,
    edit: changes,
  });
}
function acknowledgement() {
  return vi
    .mocked(invoke)
    .mock.calls.find(([command]) => command === "lsp_respond_workspace_edit")?.[1];
}
async function action(payload: unknown) {
  vi.mocked(invoke).mockResolvedValueOnce([
    { id: "fix", title: "Fix", hasCommand: false, hasEdit: true, isPreferred: false, payload },
  ]);
  const actions = await client.getCodeActions(path, {
    startLine: 0,
    startColumn: 0,
    endLine: 0,
    endColumn: 5,
  });
  return actions[0].payload;
}
beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  owner().setState({ buffers: [buffer()], activeBufferId: "a" });
  io.read.mockReset().mockResolvedValue("alpha");
  io.write.mockReset().mockResolvedValue(undefined);
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) =>
      command === "lsp_validate_workspace_edit_owner" ? true : { applied: true },
    );
  boundary.documentVersions.clear();
  boundary.documentVersions.set(path, 1);
  boundary.documentChangeQueues.clear();
  boundary.documentChangeSendsPending.clear();
});

describe("language server workspace edit ownership", () => {
  it("checks the native client owner before applying and acknowledges the request", async () => {
    const token = register();
    await request(token);
    expect(content()).toBe("beta");
    expect(invoke).toHaveBeenCalledWith("lsp_validate_workspace_edit_owner", {
      clientId: "native-client",
      ownerToken: token,
    });
    expect(acknowledgement()).toMatchObject({ requestId: 42, applied: true });
  });
  it("applies server requests to their inactive owner rather than the active workspace", async () => {
    const token = register();
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({ buffers: [buffer()] });
    await request(token);
    expect(content()).toBe("beta");
    expect((useBufferStore.getState().buffers[0] as EditorContent).content).toBe("alpha");
  });
  it("rejects an unknown token and still acknowledges failure", async () => {
    await request("unknown");
    expect(content()).toBe("alpha");
    expect(acknowledgement()).toMatchObject({
      applied: false,
      failureReason: expect.stringContaining("owner"),
    });
  });
  it("rejects old requests after the workspace closes and reopens with the same ID", async () => {
    const token = register();
    workspaceRuntimeRegistry.removeWorkspace("owner");
    workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Reopened" });
    owner().setState({ buffers: [buffer()] });
    register();
    await request(token);
    expect(content()).toBe("alpha");
    expect(acknowledgement()).toMatchObject({ applied: false });
  });
  it("keeps distinct roots in one workspace independently owned", async () => {
    const first = register("/p");
    const second = register("/q");
    expect(first).not.toBe(second);
    await request(first);
    expect(content()).toBe("beta");
    expect(acknowledgement()).toMatchObject({ applied: true });
  });
  it("rejects a stopped or replaced native client", async () => {
    const token = register();
    vi.mocked(invoke).mockResolvedValueOnce(false);
    await request(token);
    expect(content()).toBe("alpha");
    expect(acknowledgement()).toMatchObject({
      applied: false,
      failureReason: expect.stringContaining("stopped or replaced"),
    });
  });
  it("rejects newer typing during native ownership verification", async () => {
    const token = register();
    vi.mocked(invoke).mockImplementationOnce(async () => {
      owner().getState().actions.updateBufferContent("a", "newer", true);
      return true;
    });
    await request(token);
    expect(content()).toBe("newer");
    expect(acknowledgement()).toMatchObject({ applied: false });
  });
  it("acknowledges a versioned partial failure with the original failedChange", async () => {
    const token = register();
    io.write.mockRejectedValue(new Error("Disk changed"));
    await request(token, {
      documentChanges: [
        { textDocument: { uri: "file:///p/a.ts", version: 1 }, edits: [replacement] },
        { textDocument: { uri: "file:///p/b.ts", version: null }, edits: [replacement] },
      ],
    });
    expect(content()).toBe("beta");
    expect(acknowledgement()).toMatchObject({
      applied: false,
      failedChange: 1,
      failureReason: expect.stringContaining("already changed"),
    });
  });
  it("looks up version and pending state using the original Windows buffer path", () => {
    const windowsPath = "c:\\work\\a.ts";
    owner().setState({ buffers: [{ ...buffer(), path: windowsPath }] });
    boundary.documentVersions.set(windowsPath, 3);
    const owned = client.createWorkspaceEditContext();
    expect(owned.getDocumentVersion?.("C:/work/a.ts")).toBe(3);
    boundary.documentChangeSendsPending.add(windowsPath);
    expect(owned.getDocumentVersion?.("C:/work/a.ts")).toBeUndefined();
  });
  it("does not expose a document version while edits are queued or sending", () => {
    expect(client.createWorkspaceEditContext().getDocumentVersion?.(path)).toBe(1);
    boundary.documentChangeQueues.set(path, []);
    expect(client.createWorkspaceEditContext().getDocumentVersion?.(path)).toBeUndefined();
    boundary.documentChangeQueues.clear();
    boundary.documentChangeSendsPending.add(path);
    expect(client.createWorkspaceEditContext().getDocumentVersion?.(path)).toBeUndefined();
  });
});

describe("owned code actions", () => {
  it("retains the original workspace when an action is selected later", async () => {
    const payload = await action({ edit });
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({ buffers: [buffer()] });
    expect(await client.applyCodeAction(path, payload)).toEqual({ applied: true });
    expect(content()).toBe("beta");
    expect((useBufferStore.getState().buffers[0] as EditorContent).content).toBe("alpha");
  });
  it("rejects actions when the requesting document changed even if only another file is edited", async () => {
    const payload = await action({ edit: { changes: { "file:///p/b.ts": [replacement] } } });
    owner().getState().actions.updateBufferContent("a", "newer", true);
    expect(await client.applyCodeAction(path, payload)).toMatchObject({ applied: false });
    expect(io.write).not.toHaveBeenCalled();
  });
  it("does not execute a command after unsupported resource edits", async () => {
    const payload = await action({
      edit: { documentChanges: [{ kind: "create", uri: "file:///p/new.ts" }] },
      command: { command: "create" },
    });
    expect(await client.applyCodeAction(path, payload)).toMatchObject({
      applied: false,
      reason: expect.stringContaining("unsupported"),
    });
    expect(
      vi.mocked(invoke).mock.calls.filter(([name]) => name === "lsp_apply_code_action"),
    ).toHaveLength(0);
  });
  it("does not execute disabled actions", async () => {
    const payload = await action({
      edit,
      disabled: { reason: "Not available" },
      command: { command: "fix" },
    });
    expect(await client.applyCodeAction(path, payload)).toEqual({
      applied: false,
      reason: "Not available",
    });
    expect(content()).toBe("alpha");
  });
  it("reports applied edits honestly if the accompanying command fails", async () => {
    const payload = await action({ edit, command: { command: "fix" } });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Command unavailable"));
    expect(await client.applyCodeAction(path, payload)).toMatchObject({
      applied: true,
      reason: expect.stringContaining("Edits applied, but"),
    });
    expect(content()).toBe("beta");
  });
  it("refuses actions from a retired workspace generation", async () => {
    const payload = await action({ edit });
    workspaceRuntimeRegistry.removeWorkspace("owner");
    workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Reopened" });
    owner().setState({ buffers: [buffer()] });
    expect(await client.applyCodeAction(path, payload)).toMatchObject({ applied: false });
    expect(content()).toBe("alpha");
  });
});
