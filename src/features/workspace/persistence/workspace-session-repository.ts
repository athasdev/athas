import type { AIWorkspaceSessionSnapshot } from "@/features/ai/stores/ai-chat/ai-chat-store.types";
import {
  buildTerminalRestorePayload,
  isTerminalPersistenceEnabled,
  loadWorkspaceTerminalsFromStorage,
  serializeTerminals,
} from "@/features/terminal/lib/terminal-session-storage";
import type { PaneNode } from "@/features/panes/types/pane.types";
import type { PersistedTerminal, Terminal } from "@/features/terminal/types/terminal.types";
import { type ProjectUiSession, useSessionStore } from "@/features/window/stores/session.store";
import type {
  BufferSession,
  WorkspaceFolderSession,
} from "@/features/workspace/types/workspace-session.types";

interface SaveWorkspaceSessionInput {
  projectPath: string;
  buffers: BufferSession[];
  activeBufferPath: string | null;
  terminals?: PersistedTerminal[];
  terminalLayouts?: PaneNode[];
  aiSession?: AIWorkspaceSessionSnapshot | null;
  workspaceFolders?: WorkspaceFolderSession[];
  uiState?: ProjectUiSession;
}

export const workspaceSessionRepository = {
  load(projectPath: string) {
    const session = useSessionStore.getState().actions.getSession(projectPath);
    return {
      session,
      terminalLayouts:
        isTerminalPersistenceEnabled() && session ? (session.terminalLayouts ?? []) : [],
      terminals: isTerminalPersistenceEnabled()
        ? buildTerminalRestorePayload({
            projectSessionTerminals: session?.terminals,
            storageTerminals: loadWorkspaceTerminalsFromStorage(projectPath),
            preferProjectSession: !!session,
          })
        : [],
    };
  },

  save({
    projectPath,
    buffers,
    activeBufferPath,
    terminals,
    terminalLayouts,
    aiSession,
    workspaceFolders,
    uiState,
  }: SaveWorkspaceSessionInput) {
    useSessionStore
      .getState()
      .actions.saveSession(
        projectPath,
        buffers,
        activeBufferPath,
        terminals,
        aiSession,
        workspaceFolders,
        uiState,
        terminalLayouts,
      );
  },

  loadUi(projectPath: string | undefined) {
    return useSessionStore.getState().actions.getUiState(projectPath ?? "");
  },

  saveUi(projectPath: string, uiState: ProjectUiSession) {
    useSessionStore.getState().actions.saveUiState(projectPath, uiState);
  },

  saveTerminals(projectPath: string, terminals: Terminal[], terminalLayouts: PaneNode[] = []) {
    if (!isTerminalPersistenceEnabled()) {
      return;
    }

    const previous = useSessionStore.getState().actions.getSession(projectPath);
    useSessionStore
      .getState()
      .actions.saveSession(
        projectPath,
        previous?.buffers ?? [],
        previous?.activeBufferPath ?? null,
        serializeTerminals(terminals),
        previous?.aiSession,
        previous?.workspaceFolders,
        undefined,
        terminalLayouts,
      );
  },
};
