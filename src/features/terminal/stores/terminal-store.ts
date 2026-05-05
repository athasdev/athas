import { create } from "zustand";
import type {
  Terminal,
  TerminalViewSnapshot,
  TerminalViewSnapshotInput,
} from "@/features/terminal/types/terminal";

export type TerminalWidthMode = "full" | "editor";
export type TerminalTabLayout = "horizontal" | "vertical";
export type TerminalTabSidebarPosition = "left" | "right";

let terminalSnapshotVersion = 0;

const nextTerminalSnapshotVersion = () => {
  const now = Date.now();
  terminalSnapshotVersion = Math.max(terminalSnapshotVersion + 1, now);
  return terminalSnapshotVersion;
};

interface TerminalStore {
  sessions: Map<string, Partial<Terminal>>;
  widthMode: TerminalWidthMode;
  tabLayout: TerminalTabLayout;
  tabSidebarWidth: number;
  tabSidebarPosition: TerminalTabSidebarPosition;
  updateSession: (sessionId: string, updates: Partial<Terminal>) => void;
  getSession: (sessionId: string) => Partial<Terminal> | undefined;
  saveSessionSnapshot: (
    sessionId: string,
    snapshot: TerminalViewSnapshotInput,
  ) => TerminalViewSnapshot;
  getSessionSnapshot: (sessionId: string) => TerminalViewSnapshot | undefined;
  clearSessionSnapshot: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
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

  saveSessionSnapshot: (sessionId: string, snapshot: TerminalViewSnapshotInput) => {
    const versionedSnapshot = {
      ...snapshot,
      version: nextTerminalSnapshotVersion(),
    };

    set((state) => {
      const newSessions = new Map(state.sessions);
      const currentSession = newSessions.get(sessionId) || {};

      if (
        currentSession.viewSnapshot &&
        currentSession.viewSnapshot.version > versionedSnapshot.version
      ) {
        return { sessions: newSessions };
      }

      newSessions.set(sessionId, {
        ...currentSession,
        serializedContent: versionedSnapshot.serializedContent,
        viewSnapshot: versionedSnapshot,
      });
      return { sessions: newSessions };
    });

    return get().sessions.get(sessionId)?.viewSnapshot ?? versionedSnapshot;
  },

  getSessionSnapshot: (sessionId: string) => {
    return get().sessions.get(sessionId)?.viewSnapshot;
  },

  clearSessionSnapshot: (sessionId: string) => {
    set((state) => {
      const currentSession = state.sessions.get(sessionId);
      if (!currentSession?.viewSnapshot) return state;

      const newSessions = new Map(state.sessions);
      const { viewSnapshot: _viewSnapshot, ...nextSession } = currentSession;
      newSessions.set(sessionId, nextSession);
      return { sessions: newSessions };
    });
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
