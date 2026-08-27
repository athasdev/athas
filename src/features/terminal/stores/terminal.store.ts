import { createStore } from "zustand/vanilla";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

export type TerminalWidthMode = "full" | "editor";

export interface TerminalStore {
  sessions: Map<string, Partial<Terminal>>;
  widthMode: TerminalWidthMode;
  actions: {
    updateSession: (sessionId: string, updates: Partial<Terminal>) => void;
    getSession: (sessionId: string) => Partial<Terminal> | undefined;
    removeSession: (sessionId: string) => void;
    setWidthMode: (mode: TerminalWidthMode) => void;
  };
}

const createTerminalStore = () =>
  createStore<TerminalStore>()((set, get) => ({
    sessions: new Map(),
    widthMode: "editor",

    actions: {
      updateSession: (sessionId: string, updates: Partial<Terminal>) => {
        set((state) => {
          const newSessions = new Map(state.sessions);
          const currentSession = newSessions.get(sessionId) || {};
          newSessions.set(sessionId, { ...currentSession, ...updates });
          return { sessions: newSessions };
        });
      },

      getSession: (sessionId: string) => {
        return get().sessions.get(sessionId);
      },

      removeSession: (sessionId: string) => {
        set((state) => {
          const newSessions = new Map(state.sessions);
          newSessions.delete(sessionId);
          return { sessions: newSessions };
        });
      },

      setWidthMode: (mode: TerminalWidthMode) => {
        set({ widthMode: mode });
      },
    },
  }));

export const useTerminalStore = createWorkspaceScopedStore("terminal", createTerminalStore);
