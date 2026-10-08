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
import { isRestorableBufferSession } from "@/features/workspace/persistence/workspace-session-codec";
import { normalizeWorkspaceRootPath } from "@/features/window/utils/project-tab-path";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";

export interface ProjectSession {
  projectPath: string;
  workspaceFolders?: WorkspaceFolderSession[];
  activeBufferPath: string | null;
  buffers: BufferSession[];
  terminals: PersistedTerminal[];
  terminalLayouts?: PaneNode[];
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

/**
 * 2: each group's `bufferPaths` is its tab order and its pinned/preview paths are the only record
 * of those flags. Sessions without a version kept tab order in the saved buffer list instead.
 */
export const PROJECT_PANE_SESSION_VERSION = 2;

export interface ProjectPaneSession {
  version?: number;
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
      terminalLayouts?: PaneNode[],
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
  terminalLayouts,
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
  terminalLayouts?: PaneNode[];
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
    terminalLayouts:
      terminalLayouts === undefined ? previousSession?.terminalLayouts : terminalLayouts,
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

/**
 * Sessions saved before workspace roots were normalized sit under the path as it was opened
 * (`/a/b/`, `/a//b`). Finds such a session for a root that has none under its own key.
 */
function findLegacySessionKey(
  sessions: Record<string, ProjectSession>,
  projectPath: string,
): string | null {
  if (!projectPath || sessions[projectPath]) return null;
  const normalizedPath = normalizeWorkspaceRootPath(projectPath);
  for (const key of Object.keys(sessions)) {
    if (key !== projectPath && normalizeWorkspaceRootPath(key) === normalizedPath) return key;
  }
  return null;
}

const useSessionStoreBase = create<SessionState>()(
  persist(
    (set, get) => {
      /** Moves a session found under a legacy key to `projectPath`, once. */
      const adoptLegacySession = (projectPath: string) => {
        const { sessions } = get();
        const legacyKey = findLegacySessionKey(sessions, projectPath);
        if (!legacyKey) return;
        const { [legacyKey]: legacySession, ...rest } = sessions;
        set({ sessions: { ...rest, [projectPath]: { ...legacySession, projectPath } } });
      };

      return {
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
            terminalLayouts,
          ) => {
            adoptLegacySession(projectPath);
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
                  terminalLayouts,
                  now: Date.now(),
                }),
              },
            }));
          },

          getSession: (projectPath) => {
            adoptLegacySession(projectPath);
            const session = get().sessions[projectPath];
            if (!session) return null;
            const buffers = session.buffers.filter(isRestorableBufferSession);
            if (buffers.length === session.buffers.length) return session;
            return {
              ...session,
              buffers,
              activeBufferPath: buffers.some((buffer) => buffer.path === session.activeBufferPath)
                ? session.activeBufferPath
                : (buffers[0]?.path ?? null),
            };
          },

          saveUiState: (projectPath, uiState) => {
            adoptLegacySession(projectPath);
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
            adoptLegacySession(projectPath);
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
      };
    },
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
