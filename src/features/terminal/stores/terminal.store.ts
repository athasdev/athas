import { createStore } from "zustand/vanilla";
import type { Terminal } from "@/features/terminal/types/terminal.types";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";

export type TerminalWidthMode = "full" | "editor";

export interface TerminalStore {
  workspaceId: string;
  sessions: Map<string, Partial<Terminal>>;
  widthMode: TerminalWidthMode;
  actions: {
    registerSession: (sessionId: string, initial?: Partial<Terminal>) => AbortSignal;
    getSessionSignal: (sessionId: string) => AbortSignal | undefined;
    updateSession: (sessionId: string, updates: Partial<Terminal>) => void;
    getSession: (sessionId: string) => Partial<Terminal> | undefined;
    removeSession: (sessionId: string) => void;
    setWidthMode: (mode: TerminalWidthMode) => void;
  };
}

const createTerminalStore = (workspaceId: string) => {
  const lifetimes = new Map<string, AbortController>();
  return createStore<TerminalStore>()((set, get) => ({
    workspaceId,
    sessions: new Map(),
    widthMode: "editor",

    actions: {
      registerSession: (sessionId, initial = {}) => {
        let lifetime = lifetimes.get(sessionId);
        if (!lifetime) {
          lifetime = new AbortController();
          lifetimes.set(sessionId, lifetime);
          set((state) => {
            if (state.sessions.has(sessionId)) return state;
            const sessions = new Map(state.sessions);
            sessions.set(sessionId, { ...initial });
            return { sessions };
          });
        }
        return lifetime.signal;
      },
      getSessionSignal: (sessionId) => lifetimes.get(sessionId)?.signal,

      updateSession: (sessionId: string, updates: Partial<Terminal>) => {
        // Titles and directories repeat often; an unchanged session keeps the same Map
        // so tab bars and other subscribers don't re-render.
        const currentSession = get().sessions.get(sessionId);
        if (!currentSession) return;
        if (
          Object.entries(updates).every(
            ([key, value]) => currentSession[key as keyof Terminal] === value,
          )
        ) {
          return;
        }
        set((state) => {
          const currentSession = state.sessions.get(sessionId);
          if (!currentSession) return state;
          const changed = Object.entries(updates).some(
            ([key, value]) => !Object.is(currentSession[key as keyof Terminal], value),
          );
          if (!changed) return state;

          const newSessions = new Map(state.sessions);
          newSessions.set(sessionId, { ...currentSession, ...updates });
          return { sessions: newSessions };
        });
      },

      getSession: (sessionId: string) => {
        return get().sessions.get(sessionId);
      },

      removeSession: (sessionId: string) => {
        const lifetime = lifetimes.get(sessionId);
        lifetimes.delete(sessionId);
        set((state) => {
          if (!state.sessions.has(sessionId)) return state;
          const newSessions = new Map(state.sessions);
          newSessions.delete(sessionId);
          return { sessions: newSessions };
        });
        lifetime?.abort();
      },

      setWidthMode: (mode: TerminalWidthMode) => {
        set((state) => (state.widthMode === mode ? state : { widthMode: mode }));
      },
    },
  }));
};

export const useTerminalStore = createWorkspaceScopedStore("terminal", createTerminalStore);
