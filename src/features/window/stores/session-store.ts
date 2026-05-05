import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import type { AIWorkspaceSessionSnapshot } from "@/features/ai/store/types";
import type { PersistedEditorViewState } from "@/features/editor/types/editor-session";
import type { PaneNode } from "@/features/panes/types/pane";
import type { PersistedTerminal } from "@/features/terminal/types/terminal";
import type { BottomPaneTab } from "@/features/window/stores/ui-state/types";
import { createSelectors } from "@/utils/zustand-selectors";

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
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
}

interface WebViewerBufferSession {
  type: "webViewer";
  path: string;
  name: string;
  isPinned: boolean;
  url: string;
  zoomLevel?: number;
  profileKey?: string;
  history?: string[];
  historyIndex?: number;
}

export type BufferSession = EditorBufferSession | TerminalBufferSession | WebViewerBufferSession;

export interface WorkspaceFolderSession {
  path: string;
  name: string;
  isPrimary?: boolean;
}

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

export interface ProjectPaneGroupSession {
  id: string;
  type: "group";
  bufferPaths: string[];
  activeBufferPath: string | null;
}

export interface ProjectPaneSplitSession {
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
  fullscreenPaneId: string | null;
}

interface SessionState {
  sessions: Record<string, ProjectSession>;
  saveSession: (
    projectPath: string,
    buffers: BufferSession[],
    activeBufferPath: string | null,
    terminals?: PersistedTerminal[],
    aiSession?: AIWorkspaceSessionSnapshot | null,
    workspaceFolders?: WorkspaceFolderSession[],
  ) => void;
  getSession: (projectPath: string) => ProjectSession | null;
  saveUiState: (projectPath: string, uiState: ProjectUiSession) => void;
  getUiState: (projectPath: string) => ProjectUiSession | null;
  clearSession: (projectPath: string) => void;
  clearAllSessions: () => void;
}

export function buildSavedProjectSession({
  previousSession,
  projectPath,
  buffers,
  activeBufferPath,
  terminals,
  aiSession,
  workspaceFolders,
  now,
}: {
  previousSession?: ProjectSession;
  projectPath: string;
  buffers: BufferSession[];
  activeBufferPath: string | null;
  terminals?: PersistedTerminal[];
  aiSession?: AIWorkspaceSessionSnapshot | null;
  workspaceFolders?: WorkspaceFolderSession[];
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
    uiState: previousSession?.uiState ?? null,
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

      saveSession: (
        projectPath,
        buffers,
        activeBufferPath,
        terminals,
        aiSession,
        workspaceFolders,
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
    }),
    {
      name: "athas-tab-sessions",
      version: 1,
    },
  ),
);

export const useSessionStore = createSelectors(useSessionStoreBase);
