import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";

interface BufferSession {
  id?: string;
  path: string;
  name: string;
  isPinned: boolean;
}

interface ProjectSession {
  projectPath: string;
  activeBufferPath: string | null;
  buffers: BufferSession[];
  lastSaved: number;
}

interface SessionState {
  sessions: Record<string, ProjectSession>;
  saveSession: (
    projectPath: string,
    buffers: BufferSession[],
    activeBufferPath: string | null,
  ) => void;
  getSession: (projectPath: string) => ProjectSession | null;
  clearSession: (projectPath: string) => void;
  clearAllSessions: () => void;
}

const useSessionStoreBase = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},

      saveSession: (projectPath, buffers, activeBufferPath) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [projectPath]: {
              projectPath,
              activeBufferPath,
              buffers,
              lastSaved: Date.now(),
            },
          },
        }));
      },

      getSession: (projectPath) => {
        return get().sessions[projectPath] || null;
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
