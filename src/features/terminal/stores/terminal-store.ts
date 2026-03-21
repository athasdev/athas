import { create } from "zustand";
import type { Terminal } from "@/features/terminal/types/terminal";

export type TerminalWidthMode = "full" | "editor";
export type TerminalTabLayout = "horizontal" | "vertical";

interface TerminalStore {
  sessions: Map<string, Partial<Terminal>>;
  widthMode: TerminalWidthMode;
  tabLayout: TerminalTabLayout;
  tabSidebarWidth: number;
  updateSession: (sessionId: string, updates: Partial<Terminal>) => void;
  getSession: (sessionId: string) => Partial<Terminal> | undefined;
  setWidthMode: (mode: TerminalWidthMode) => void;
  setTabLayout: (layout: TerminalTabLayout) => void;
  setTabSidebarWidth: (width: number) => void;
}

export const useTerminalStore = create<TerminalStore>()((set, get) => ({
  sessions: new Map(),
  widthMode: "editor",
  tabLayout: "horizontal",
  tabSidebarWidth: 180,

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

  setTabLayout: (tabLayout: TerminalTabLayout) => {
    set({ tabLayout });
  },

  setTabSidebarWidth: (tabSidebarWidth: number) => {
    set({ tabSidebarWidth: Math.max(80, Math.min(400, tabSidebarWidth)) });
  },
}));
