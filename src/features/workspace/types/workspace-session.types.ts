import type { PersistedEditorViewState } from "@/features/editor/types/editor-session.types";

interface EditorBufferSession {
  type: "editor";
  id?: string;
  path: string;
  name: string;
  isPinned: boolean;
  isPreview?: boolean;
  workspaceScope?: "workspace" | "external";
  editorState?: PersistedEditorViewState;
}

interface TerminalBufferSession {
  type: "terminal";
  path: string;
  name: string;
  isPinned: boolean;
  sessionId: string;
  shell?: string;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
}

export type BufferSession = EditorBufferSession | TerminalBufferSession;

export interface WorkspaceFolderSession {
  path: string;
  name: string;
  isPrimary?: boolean;
}
