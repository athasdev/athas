import { create } from "zustand";
import type { Terminal } from "@/features/terminal/types/terminal";

export type TerminalWidthMode = "full" | "editor";
export type TerminalTabLayout = "horizontal" | "vertical";
export type TerminalTabSidebarPosition = "left" | "right";

interface TerminalStore {
  sessions: Map<string, Partial<Terminal>>;
  widthMode: TerminalWidthMode;
  tabLayout: TerminalTabLayout;
  tabSidebarWidth: number;
  tabSidebarPosition: TerminalTabSidebarPosition;
  updateSession: (sessionId: string, updates: Partial<Terminal>) => void;
  getSession: (sessionId: string) => Partial<Terminal> | undefined;
  setWidthMode: (mode: TerminalWidthMode) => void;
  setTabLayout: (layout: TerminalTabLayout) => void;
  setTabSidebarWidth: (width: number) => void;
  setTabSidebarPosition: (position: TerminalTabSidebarPosition) => void;
}

export const useTerminalStore = create<TerminalStore>()((set, get) => ({
  sessions: new Map(),
  widthMode: "editor",
  tabLayout: "horizontal",
  tabSidebarWidth: 180,
  tabSidebarPosition: "left",

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

  setTabSidebarPosition: (tabSidebarPosition: TerminalTabSidebarPosition) => {
    set({ tabSidebarPosition });
  },
}));
