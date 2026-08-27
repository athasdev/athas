import type { OpenContentSpec } from "@/features/panes/types/pane-content.types";
import type { BufferSession } from "@/features/workspace/types/workspace-session.types";

type RestoredVirtualContentSpec = Extract<OpenContentSpec, { type: "terminal" | "webViewer" }>;

interface WorkspaceSessionBufferRestoreContext {
  openContent: (spec: RestoredVirtualContentSpec) => string;
  openFile: (path: string, isPreview?: boolean) => Promise<void>;
  findBufferIdByPath: (path: string) => string | null;
  pinBuffer: (bufferId: string) => void;
  restoreEditorState: (buffer: BufferSession) => void;
}

export async function restoreWorkspaceSessionBuffer(
  buffer: BufferSession,
  context: WorkspaceSessionBufferRestoreContext,
): Promise<string | null> {
  let restoredBufferId: string | null = null;

  if (buffer.type === "terminal") {
    restoredBufferId = context.openContent({
      type: "terminal",
      name: buffer.name,
      command: buffer.initialCommand,
      shell: buffer.shell,
      workingDirectory: buffer.workingDirectory,
      remoteConnectionId: buffer.remoteConnectionId,
      sessionId: buffer.sessionId,
      path: buffer.path,
    });
  } else if (buffer.type === "webViewer") {
    restoredBufferId = context.openContent({
      type: "webViewer",
      url: buffer.url ?? "about:blank",
      zoomLevel: buffer.zoomLevel,
      profileKey: buffer.profileKey,
      history: buffer.history,
      historyIndex: buffer.historyIndex,
    });
  } else {
    await context.openFile(buffer.path, buffer.isPreview);
    context.restoreEditorState(buffer);
    restoredBufferId = context.findBufferIdByPath(buffer.path);
  }

  if (buffer.isPinned && restoredBufferId) {
    context.pinBuffer(restoredBufferId);
  }

  return restoredBufferId;
}
