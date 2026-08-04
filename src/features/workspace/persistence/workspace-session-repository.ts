import type { AIWorkspaceSessionSnapshot } from "@/features/ai/stores/ai-chat/ai-chat-store.types";
import {
  buildTerminalRestorePayload,
  isTerminalPersistenceEnabled,
  loadWorkspaceTerminalsFromStorage,
  serializeTerminals,
} from "@/features/terminal/lib/terminal-session-storage";
import type { PersistedTerminal, Terminal } from "@/features/terminal/types/terminal.types";
import {
  type BufferSession,
  type ProjectUiSession,
  useSessionStore,
  type WorkspaceFolderSession,
} from "@/features/window/stores/session.store";

interface SaveWorkspaceSessionInput {
  projectPath: string;
  buffers: BufferSession[];
  activeBufferPath: string | null;
  terminals?: PersistedTerminal[];
  aiSession?: AIWorkspaceSessionSnapshot | null;
  workspaceFolders?: WorkspaceFolderSession[];
  uiState?: ProjectUiSession;
}

export const workspaceSessionRepository = {
  load(projectPath: string) {
    const session = useSessionStore.getState().actions.getSession(projectPath);
    return {
      session,
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
      );
  },

  loadUi(projectPath: string | undefined) {
    return useSessionStore.getState().actions.getUiState(projectPath ?? "");
  },

  saveUi(projectPath: string, uiState: ProjectUiSession) {
    useSessionStore.getState().actions.saveUiState(projectPath, uiState);
  },

  saveTerminals(projectPath: string, terminals: Terminal[]) {
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
      );
  },
};
