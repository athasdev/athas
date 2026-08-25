import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import type { AIWorkspaceSessionSnapshot } from "@/features/ai/stores/ai-chat/ai-chat-store.types";
import type { PaneNode } from "@/features/panes/types/pane.types";
import type { PersistedTerminal } from "@/features/terminal/types/terminal.types";
import type { BottomPaneTab } from "@/features/window/stores/ui-state/types/ui-state.types";
import type {
  BufferSession,
  WorkspaceFolderSession,
} from "@/features/workspace/types/workspace-session.types";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";

export interface ProjectSession {
  projectPath: string;
  workspaceFolders?: WorkspaceFolderSession[];
  activeBufferPath: string | null;
  buffers: BufferSession[];
  terminals: PersistedTerminal[];
  aiSession: AIWorkspaceSessionSnapshot | null;
  uiState: ProjectUiSession | null;
  lastSaved: number;
}

export interface ProjectUiSession {
  isSidebarVisible: boolean;
  isBottomPaneVisible: boolean;
  bottomPaneActiveTab: BottomPaneTab;
  activeSidebarView: SidebarView;
  paneState?: ProjectPaneSession | null;
}

interface ProjectPaneGroupSession {
  id: string;
  type: "group";
  bufferPaths: string[];
  activeBufferPath: string | null;
  mruBufferPaths?: string[];
  previewBufferPath?: string | null;
  pinnedBufferPaths?: string[];
  locked?: boolean;
}

interface ProjectPaneSplitSession {
  id: string;
  type: "split";
  direction: Extract<PaneNode, { type: "split" }>["direction"];
  children: [ProjectPaneSessionNode, ProjectPaneSessionNode];
  sizes: [number, number];
}

export type ProjectPaneSessionNode = ProjectPaneGroupSession | ProjectPaneSplitSession;

export interface ProjectPaneSession {
  root: ProjectPaneSessionNode;
  bottomRoot: ProjectPaneSessionNode;
  activePaneId: string;
  mostRecentActivePaneIds?: string[];
  fullscreenPaneId: string | null;
}

interface SessionState {
  sessions: Record<string, ProjectSession>;
  actions: {
    saveSession: (
      projectPath: string,
      buffers: BufferSession[],
      activeBufferPath: string | null,
      terminals?: PersistedTerminal[],
      aiSession?: AIWorkspaceSessionSnapshot | null,
      workspaceFolders?: WorkspaceFolderSession[],
      uiState?: ProjectUiSession,
    ) => void;
    getSession: (projectPath: string) => ProjectSession | null;
    saveUiState: (projectPath: string, uiState: ProjectUiSession) => void;
    getUiState: (projectPath: string) => ProjectUiSession | null;
    clearSession: (projectPath: string) => void;
    clearAllSessions: () => void;
  };
}

export function buildSavedProjectSession({
  previousSession,
  projectPath,
  buffers,
  activeBufferPath,
  terminals,
  aiSession,
  workspaceFolders,
  uiState,
  now,
}: {
  previousSession?: ProjectSession;
  projectPath: string;
  buffers: BufferSession[];
  activeBufferPath: string | null;
  terminals?: PersistedTerminal[];
  aiSession?: AIWorkspaceSessionSnapshot | null;
  workspaceFolders?: WorkspaceFolderSession[];
  uiState?: ProjectUiSession;
  now: number;
}): ProjectSession {
  return {
    ...previousSession,
    projectPath,
    workspaceFolders:
      workspaceFolders === undefined ? previousSession?.workspaceFolders : workspaceFolders,
    activeBufferPath,
    buffers,
    terminals: terminals === undefined ? (previousSession?.terminals ?? []) : terminals,
    aiSession: aiSession === undefined ? (previousSession?.aiSession ?? null) : aiSession,
    uiState: uiState === undefined ? (previousSession?.uiState ?? null) : uiState,
    lastSaved: now,
  };
}

export function buildSavedProjectUiSession({
  previousSession,
  projectPath,
  uiState,
  now,
}: {
  previousSession?: ProjectSession;
  projectPath: string;
  uiState: ProjectUiSession;
  now: number;
}): ProjectSession {
  const nextUiState: ProjectUiSession = {
    ...uiState,
    paneState:
      uiState.paneState === undefined
        ? (previousSession?.uiState?.paneState ?? null)
        : uiState.paneState,
  };

  return {
    ...previousSession,
    projectPath,
    activeBufferPath: previousSession?.activeBufferPath ?? null,
    buffers: previousSession?.buffers ?? [],
    terminals: previousSession?.terminals ?? [],
    aiSession: previousSession?.aiSession ?? null,
    uiState: nextUiState,
    lastSaved: now,
  };
}

const useSessionStoreBase = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},

      actions: {
        saveSession: (
          projectPath,
          buffers,
          activeBufferPath,
          terminals,
          aiSession,
          workspaceFolders,
          uiState,
        ) => {
          set((state) => ({
            sessions: {
              ...state.sessions,
              [projectPath]: buildSavedProjectSession({
                previousSession: state.sessions[projectPath],
                projectPath,
                buffers,
                activeBufferPath,
                terminals,
                aiSession,
                workspaceFolders,
                uiState,
                now: Date.now(),
              }),
            },
          }));
        },

        getSession: (projectPath) => {
          return get().sessions[projectPath] || null;
        },

        saveUiState: (projectPath, uiState) => {
          set((state) => ({
            sessions: {
              ...state.sessions,
              [projectPath]: buildSavedProjectUiSession({
                previousSession: state.sessions[projectPath],
                projectPath,
                uiState,
                now: Date.now(),
              }),
            },
          }));
        },

        getUiState: (projectPath) => {
          return get().sessions[projectPath]?.uiState ?? null;
        },

        clearSession: (projectPath) => {
          set((state) => {
            const { [projectPath]: _, ...rest } = state.sessions;
            return { sessions: rest };
          });
        },

        clearAllSessions: () => {
          set({ sessions: {} });
        },
      },
    }),
    {
      name: "athas-tab-sessions",
      version: 1,
      storage: createSafeJSONStorage<Pick<SessionState, "sessions">>(),
      partialize: ({ sessions }) => ({ sessions }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Pick<SessionState, "sessions">),
        actions: currentState.actions,
      }),
    },
  ),
);

export const useSessionStore = createSelectors(useSessionStoreBase);
