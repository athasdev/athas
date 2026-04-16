import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import type { AIWorkspaceSessionSnapshot } from "@/features/ai/store/types";
import type { PersistedTerminal } from "@/features/terminal/types/terminal";
import type { BottomPaneTab } from "@/features/window/stores/ui-state/types";
import { createSelectors } from "@/utils/zustand-selectors";

interface EditorBufferSession {
  type: "editor";
  id?: string;
  path: string;
  name: string;
  isPinned: boolean;
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
}

export type BufferSession = EditorBufferSession | TerminalBufferSession | WebViewerBufferSession;

interface ProjectSession {
  projectPath: string;
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
}

interface SessionState {
  sessions: Record<string, ProjectSession>;
  saveSession: (
    projectPath: string,
    buffers: BufferSession[],
    activeBufferPath: string | null,
    terminals?: PersistedTerminal[],
    aiSession?: AIWorkspaceSessionSnapshot | null,
  ) => void;
  getSession: (projectPath: string) => ProjectSession | null;
  saveUiState: (projectPath: string, uiState: ProjectUiSession) => void;
  getUiState: (projectPath: string) => ProjectUiSession | null;
  clearSession: (projectPath: string) => void;
  clearAllSessions: () => void;
}

const useSessionStoreBase = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},

      saveSession: (projectPath, buffers, activeBufferPath, terminals, aiSession) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [projectPath]: {
              ...state.sessions[projectPath],
              projectPath,
              activeBufferPath,
              buffers,
              terminals: terminals ?? state.sessions[projectPath]?.terminals ?? [],
              aiSession: aiSession ?? state.sessions[projectPath]?.aiSession ?? null,
              uiState: state.sessions[projectPath]?.uiState ?? null,
              lastSaved: Date.now(),
            },
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
            [projectPath]: {
              ...state.sessions[projectPath],
              projectPath,
              activeBufferPath: state.sessions[projectPath]?.activeBufferPath ?? null,
              buffers: state.sessions[projectPath]?.buffers ?? [],
              terminals: state.sessions[projectPath]?.terminals ?? [],
              aiSession: state.sessions[projectPath]?.aiSession ?? null,
              uiState,
              lastSaved: Date.now(),
            },
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
