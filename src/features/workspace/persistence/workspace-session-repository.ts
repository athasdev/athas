import type { AIWorkspaceSessionSnapshot } from "@/features/ai/types/ai-chat-store.types";
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
}

export const workspaceSessionRepository = {
  load(projectPath: string) {
    const session = useSessionStore.getState().getSession(projectPath);
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
  }: SaveWorkspaceSessionInput) {
    useSessionStore
      .getState()
      .saveSession(projectPath, buffers, activeBufferPath, terminals, aiSession, workspaceFolders);
  },

  loadUi(projectPath: string | undefined) {
    return useSessionStore.getState().getUiState(projectPath ?? "");
  },

  saveUi(projectPath: string, uiState: ProjectUiSession) {
    useSessionStore.getState().saveUiState(projectPath, uiState);
  },

  saveTerminals(projectPath: string, terminals: Terminal[]) {
    if (!isTerminalPersistenceEnabled()) {
      return;
    }

    const previous = useSessionStore.getState().getSession(projectPath);
    useSessionStore
      .getState()
      .saveSession(
        projectPath,
        previous?.buffers ?? [],
        previous?.activeBufferPath ?? null,
        serializeTerminals(terminals),
        previous?.aiSession,
        previous?.workspaceFolders,
      );
  },
};
