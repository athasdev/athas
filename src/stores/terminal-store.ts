import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Terminal } from "../types/terminal";

export type TerminalWidthMode = "full" | "editor";

interface TerminalStore {
  sessions: Map<string, Partial<Terminal>>;
  widthMode: TerminalWidthMode;
  updateSession: (sessionId: string, updates: Partial<Terminal>) => void;
  getSession: (sessionId: string) => Partial<Terminal> | undefined;
  setWidthMode: (mode: TerminalWidthMode) => void;
}

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set, get) => ({
      sessions: new Map(),
      widthMode: "full",

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

      setWidthMode: (mode: TerminalWidthMode) => {
        set({ widthMode: mode });
      },
    }),
    {
      name: "terminal-store",
      partialize: (state) => ({ widthMode: state.widthMode }),
    },
  ),
);
