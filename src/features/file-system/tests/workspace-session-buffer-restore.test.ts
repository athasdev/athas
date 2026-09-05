import { describe, expect, it, vi } from "vite-plus/test";
import type { BufferSession } from "@/features/workspace/types/workspace-session.types";
import { restoreWorkspaceSessionBuffer } from "../services/workspace-session-buffer-restore";

const createContext = () => ({
  openContent: vi.fn(() => "virtual-buffer"),
  openFile: vi.fn().mockResolvedValue(undefined),
  findBufferIdByPath: vi.fn<(path: string) => string | null>(() => "editor-buffer"),
  pinBuffer: vi.fn(),
  restoreEditorState: vi.fn(),
});

describe("workspace session buffer restore", () => {
  it("ignores browser tabs saved by older versions without opening their URL as a file", async () => {
    const context = createContext();
    const legacyBuffer = {
      type: "webViewer",
      path: "web-viewer://https://athas.dev",
      url: "https://athas.dev",
      isPinned: true,
    } as unknown as BufferSession;
    await expect(restoreWorkspaceSessionBuffer(legacyBuffer, context)).resolves.toBeNull();
    expect(context.openContent).not.toHaveBeenCalled();
    expect(context.openFile).not.toHaveBeenCalled();
    expect(context.pinBuffer).not.toHaveBeenCalled();
  });

  it("restores and pins a terminal with its persisted launch options", async () => {
    const context = createContext();
    const buffer: BufferSession = {
      type: "terminal",
      path: "terminal://saved",
      name: "Server",
      isPinned: true,
      sessionId: "session-1",
      shell: "zsh",
      initialCommand: "bun dev",
      workingDirectory: "/workspace",
      remoteConnectionId: "remote-1",
    };

    await expect(restoreWorkspaceSessionBuffer(buffer, context)).resolves.toBe("virtual-buffer");
    expect(context.openContent).toHaveBeenCalledWith({
      type: "terminal",
      name: "Server",
      command: "bun dev",
      shell: "zsh",
      workingDirectory: "/workspace",
      remoteConnectionId: "remote-1",
      sessionId: "session-1",
      path: "terminal://saved",
    });
    expect(context.pinBuffer).toHaveBeenCalledWith("virtual-buffer");
    expect(context.openFile).not.toHaveBeenCalled();
  });

  it("opens editor files through the main route before restoring editor state", async () => {
    const context = createContext();
    const buffer: BufferSession = {
      type: "editor",
      path: "/workspace/src/app.ts",
      name: "app.ts",
      isPinned: true,
      isPreview: true,
      editorState: {
        cursor: { line: 3, column: 4, offset: 24 },
        scrollTop: 120,
        scrollLeft: 0,
      },
    };

    await expect(restoreWorkspaceSessionBuffer(buffer, context)).resolves.toBe("editor-buffer");
    expect(context.openFile).toHaveBeenCalledWith(buffer.path, true);
    expect(context.restoreEditorState).toHaveBeenCalledWith(buffer);
    expect(context.findBufferIdByPath).toHaveBeenCalledWith(buffer.path);
    expect(context.pinBuffer).toHaveBeenCalledWith("editor-buffer");
    expect(context.openFile.mock.invocationCallOrder[0]).toBeLessThan(
      context.restoreEditorState.mock.invocationCallOrder[0],
    );
  });

  it("does not pin an editor that failed to produce a buffer", async () => {
    const context = createContext();
    context.findBufferIdByPath.mockReturnValue(null);
    const buffer: BufferSession = {
      type: "editor",
      path: "/workspace/missing.ts",
      name: "missing.ts",
      isPinned: true,
    };

    await expect(restoreWorkspaceSessionBuffer(buffer, context)).resolves.toBeNull();
    expect(context.pinBuffer).not.toHaveBeenCalled();
  });
});
