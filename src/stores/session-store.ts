import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistedTerminal } from "@/features/terminal/types/terminal";
import { createSelectors } from "@/utils/zustand-selectors";

interface BufferSession {
  kind?: "file";
  path: string;
  name: string;
  isPinned: boolean;
}

export interface AgentBufferSession {
  kind: "agent";
  sessionId: string;
  name: string;
  isPinned: boolean;
}

export type PersistedBufferSession = BufferSession | AgentBufferSession;

export type ActiveSessionBuffer =
  | { kind: "file"; path: string }
  | { kind: "agent"; sessionId: string };

interface ProjectSession {
  projectPath: string;
  activeBuffer: ActiveSessionBuffer | null;
  activeBufferPath: string | null;
  buffers: PersistedBufferSession[];
  terminals: PersistedTerminal[];
  lastSaved: number;
}

interface SessionState {
  sessions: Record<string, ProjectSession>;
  saveSession: (
    projectPath: string,
    buffers: PersistedBufferSession[],
    activeBuffer: ActiveSessionBuffer | null,
    terminals?: PersistedTerminal[],
  ) => void;
  getSession: (projectPath: string) => ProjectSession | null;
  clearSession: (projectPath: string) => void;
  clearAllSessions: () => void;
}

const useSessionStoreBase = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},

      saveSession: (projectPath, buffers, activeBuffer, terminals = []) => {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [projectPath]: {
              projectPath,
              activeBuffer,
              activeBufferPath: activeBuffer?.kind === "file" ? activeBuffer.path : null,
              buffers,
              terminals,
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
      version: 2,
    },
  ),
);

export const useSessionStore = createSelectors(useSessionStoreBase);
