import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  EditorContent,
  PaneContent,
  TerminalContent,
  WebViewerContent,
} from "@/features/panes/types/pane-content.types";
import {
  buildWorkspaceBufferSnapshot,
  encodeWorkspaceBuffer,
  getEditorWorkspaceScope,
  isLocalFileInWorkspace,
} from "@/features/workspace/persistence/workspace-session-codec";

const buildPersistedEditorViewState = vi.hoisted(() => vi.fn());

vi.mock("@/features/editor/stores/editor-session-state", () => ({
  buildPersistedEditorViewState,
}));

const createEditorBuffer = (overrides: Partial<EditorContent> = {}): EditorContent => ({
  id: "editor-1",
  type: "editor",
  path: "/workspace/src/app.ts",
  name: "app.ts",
  isPinned: true,
  isPreview: false,
  isActive: true,
  content: "const value = 1;",
  savedContent: "const value = 1;",
  isDirty: false,
  isVirtual: false,
  tokens: [],
  ...overrides,
});

const createTerminalBuffer = (): TerminalContent => ({
  id: "terminal-1",
  type: "terminal",
  path: "terminal://terminal-1",
  name: "Terminal",
  isPinned: false,
  isPreview: false,
  isActive: true,
  sessionId: "terminal-session-1",
  shell: "zsh",
  initialCommand: "bun dev",
  workingDirectory: "/workspace",
  remoteConnectionId: "remote-1",
});

const createWebViewerBuffer = (): WebViewerContent => ({
  id: "web-1",
  type: "webViewer",
  path: "webview://web-1",
  name: "Athas",
  isPinned: true,
  isPreview: false,
  isActive: false,
  url: "https://athas.dev",
  zoomLevel: 1.25,
  profileKey: "default",
  history: ["https://athas.dev", "https://athas.dev/docs"],
  historyIndex: 1,
});

describe("workspace session codec", () => {
  beforeEach(() => {
    buildPersistedEditorViewState.mockReset();
    buildPersistedEditorViewState.mockReturnValue({ scrollTop: 120 });
  });

  it("encodes editor state and workspace scope without coupling ordinary saves to editor ids", () => {
    const buffer = createEditorBuffer();

    expect(
      encodeWorkspaceBuffer(buffer, {
        workspaceRootPath: "/workspace",
      }),
    ).toEqual({
      type: "editor",
      name: "app.ts",
      path: "/workspace/src/app.ts",
      isPinned: true,
      isPreview: false,
      workspaceScope: "workspace",
      editorState: { scrollTop: 120 },
    });
    expect(buildPersistedEditorViewState).toHaveBeenCalledWith(buffer);
  });

  it("preserves editor ids and added workspace folder scope for full snapshots", () => {
    expect(
      encodeWorkspaceBuffer(createEditorBuffer({ path: "/docs/guide.md" }), {
        workspaceRootPath: "/workspace",
        workspaceFolderPaths: ["/workspace", "/docs"],
        includeEditorId: true,
      }),
    ).toMatchObject({
      type: "editor",
      id: "editor-1",
      path: "/docs/guide.md",
      workspaceScope: "workspace",
    });
  });

  it("encodes terminal and web viewer restoration metadata", () => {
    expect(
      encodeWorkspaceBuffer(createTerminalBuffer(), { workspaceRootPath: "/workspace" }),
    ).toEqual({
      type: "terminal",
      path: "terminal://terminal-1",
      name: "Terminal",
      isPinned: false,
      sessionId: "terminal-session-1",
      shell: "zsh",
      initialCommand: "bun dev",
      workingDirectory: "/workspace",
      remoteConnectionId: "remote-1",
    });
    expect(
      encodeWorkspaceBuffer(createWebViewerBuffer(), { workspaceRootPath: "/workspace" }),
    ).toEqual({
      type: "webViewer",
      path: "webview://web-1",
      name: "Athas",
      isPinned: true,
      url: "https://athas.dev",
      zoomLevel: 1.25,
      profileKey: "default",
      history: ["https://athas.dev", "https://athas.dev/docs"],
      historyIndex: 1,
    });
  });

  it("rejects virtual editors and unsupported pane content", () => {
    const unsupportedBuffer: PaneContent = {
      id: "new-tab-1",
      type: "newTab",
      path: "new-tab://new-tab-1",
      name: "New Tab",
      isPinned: false,
      isPreview: false,
      isActive: true,
    };

    expect(
      encodeWorkspaceBuffer(createEditorBuffer({ isVirtual: true }), {
        workspaceRootPath: "/workspace",
      }),
    ).toBeNull();
    expect(
      encodeWorkspaceBuffer(unsupportedBuffer, { workspaceRootPath: "/workspace" }),
    ).toBeNull();
  });

  it("builds one snapshot for open and deferred buffers without duplicate paths", () => {
    const activeBuffer = createEditorBuffer();
    const snapshot = buildWorkspaceBufferSnapshot({
      buffers: [activeBuffer, createWebViewerBuffer()],
      activeBufferId: activeBuffer.id,
      pendingBuffers: [
        {
          type: "editor",
          path: activeBuffer.path,
          name: "stale app.ts",
          isPinned: false,
        },
        {
          type: "editor",
          path: "/workspace/deferred.ts",
          name: "deferred.ts",
          isPinned: false,
        },
      ],
      workspaceRootPath: "/workspace",
      includeEditorId: true,
    });

    expect(snapshot.activeBufferPath).toBe(activeBuffer.path);
    expect(snapshot.buffers.map((buffer) => buffer.path)).toEqual([
      activeBuffer.path,
      "webview://web-1",
      "/workspace/deferred.ts",
    ]);
    expect(snapshot.buffers[0]).toMatchObject({ id: activeBuffer.id, name: "app.ts" });
  });

  it("does not save an active path for unsupported pane content", () => {
    const newTab: PaneContent = {
      id: "new-tab-1",
      type: "newTab",
      path: "new-tab://new-tab-1",
      name: "New Tab",
      isPinned: false,
      isPreview: false,
      isActive: true,
    };

    expect(
      buildWorkspaceBufferSnapshot({
        buffers: [newTab],
        activeBufferId: newTab.id,
        workspaceRootPath: "/workspace",
      }),
    ).toEqual({ buffers: [], activeBufferPath: null });
  });
});

describe("workspace file scope", () => {
  it("classifies local paths against the root and additional workspace folders", () => {
    expect(isLocalFileInWorkspace("/workspace/src/app.ts", "/workspace")).toBe(true);
    expect(isLocalFileInWorkspace("/docs/readme.md", "/workspace", ["/docs"])).toBe(true);
    expect(isLocalFileInWorkspace("/other/readme.md", "/workspace")).toBe(false);
    expect(getEditorWorkspaceScope("/other/readme.md", "/workspace")).toBe("external");
  });

  it("normalizes separators and does not classify virtual paths as external files", () => {
    expect(isLocalFileInWorkspace("C:\\workspace\\src\\app.ts", "C:\\workspace\\")).toBe(true);
    expect(getEditorWorkspaceScope("remote://conn/src/app.ts", "/workspace")).toBeUndefined();
    expect(getEditorWorkspaceScope("wsl://Ubuntu/home/me/app.ts", "/workspace")).toBeUndefined();
    expect(getEditorWorkspaceScope("diff://unstaged/src%2Fapp.ts", "/workspace")).toBeUndefined();
  });
});
