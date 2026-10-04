import type * as Monaco from "monaco-editor";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { useBufferStore } from "../stores/buffer.store";
import { LspClient } from "../lsp/lsp-client";
import { registerMonacoLspProviders } from "../engines/monaco/lsp-providers";
const providers = vi.hoisted(() => ({
  rename: undefined as Monaco.languages.RenameProvider | undefined,
  actions: undefined as Monaco.languages.CodeActionProvider | undefined,
}));
const io = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@/extensions/registry/extension-registry", () => ({
  extensionRegistry: { isLspSupported: () => true },
}));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ readText: io.read, writeText: io.write }),
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: vi.fn() }));
vi.mock("monaco-editor", () => ({
  Emitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  Range: class {},
  Uri: { parse: vi.fn() },
  editor: { addCommand: vi.fn() },
  languages: new Proxy(
    {},
    {
      get: (target, key) => {
        if (key === "registerRenameProvider")
          return (selector: unknown, provider: Monaco.languages.RenameProvider) => {
            providers.rename = provider;
          };
        if (key === "registerCodeActionProvider")
          return (selector: unknown, provider: Monaco.languages.CodeActionProvider) => {
            providers.actions = provider;
          };
        return vi.fn();
      },
    },
  ),
}));
const path = "/p/a.ts";
const replacement = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
  newText: "beta",
};
const edit = { changes: { "file:///p/a.ts": [replacement], "file:///p/b.ts": [replacement] } };
const client = LspClient.getInstance();
const model = {
  uri: { scheme: "athas", path, query: "buffer=a" },
  isDisposed: () => false,
} as unknown as Monaco.editor.ITextModel;
const position = { lineNumber: 1, column: 1 } as Monaco.Position;
const token = { isCancellationRequested: false } as Monaco.CancellationToken;
const owner = () => useBufferStore.getStore("owner");
const content = () => (owner().getState().buffers[0] as EditorContent).content;
beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  owner().setState({
    buffers: [
      {
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
        tokens: [],
      },
    ],
    activeBufferId: "a",
  });
  io.read.mockReset().mockResolvedValue("alpha");
  io.write.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
  vi.spyOn(client, "rename").mockResolvedValue(edit);
  registerMonacoLspProviders();
});
async function rename(cancellation = token) {
  return await providers.rename!.provideRenameEdits(model, position, "beta", cancellation);
}

describe("Monaco guarded refactoring", () => {
  it("applies all open and unopened rename targets through the checked service", async () => {
    expect(await rename()).toEqual({ edits: [] });
    expect(content()).toBe("beta");
    expect(io.write).toHaveBeenCalledExactlyOnceWith("/p/b.ts", "beta", "alpha");
  });
  it("does not mutate open models or disk for a canceled rename", async () => {
    expect(await rename({ ...token, isCancellationRequested: true })).toBeUndefined();
    expect(content()).toBe("alpha");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("rejects edits against an obsolete document version", async () => {
    vi.mocked(client.rename).mockResolvedValue({
      documentChanges: [
        { textDocument: { uri: "file:///p/a.ts", version: 999 }, edits: [replacement] },
      ],
    });
    await expect(rename()).rejects.toThrow("version changed");
    expect(content()).toBe("alpha");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("rejects unsupported edits before mutating any target", async () => {
    vi.mocked(client.rename).mockResolvedValue({
      changes: edit.changes,
      documentChanges: [{ kind: "delete", uri: "file:///p/a.ts" }],
    });
    await expect(rename()).rejects.toThrow("unsupported rename");
    expect(content()).toBe("alpha");
    expect(io.write).not.toHaveBeenCalled();
  });
  it("passes the original code action payload to the guarded command, including edit-only actions", async () => {
    const payload = { edit };
    vi.spyOn(client, "getCodeActions").mockResolvedValue([
      { id: "fix", title: "Fix", hasCommand: false, hasEdit: true, isPreferred: false, payload },
    ]);
    const result = await providers.actions!.provideCodeActions(
      model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 } as Monaco.Range,
      { markers: [], trigger: 1 },
      token,
    );
    expect(result?.actions[0].edit).toBeUndefined();
    expect(result?.actions[0].command).toMatchObject({
      id: "athas.executeLspCodeAction",
      arguments: [{ filePath: path, actionPayload: payload }],
    });
    expect(
      (result?.actions[0].command?.arguments?.[0] as { actionPayload: unknown } | undefined)
        ?.actionPayload,
    ).toBe(payload);
  });
});
