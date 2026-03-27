import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";
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

interface PersistedSessionState {
  sessions?: Record<string, ProjectSession>;
}

interface WrappedPersistedSessionState {
  state?: PersistedSessionState;
  version?: number;
}

const getLegacyAgentSessionId = (path: string | null | undefined): string | null => {
  if (!path?.startsWith("agent://")) {
    return null;
  }

  const sessionId = path.slice("agent://".length).trim();
  return sessionId || DEFAULT_HARNESS_SESSION_KEY;
};

const normalizePersistedBufferSession = (
  buffer: PersistedBufferSession | BufferSession,
): PersistedBufferSession => {
  if ("kind" in buffer && buffer.kind === "agent") {
    return buffer;
  }

  const legacyAgentSessionId = getLegacyAgentSessionId(buffer.path);
  if (legacyAgentSessionId) {
    return {
      kind: "agent",
      sessionId: legacyAgentSessionId,
      name: buffer.name,
      isPinned: buffer.isPinned,
    };
  }

  return {
    kind: "file",
    path: buffer.path,
    name: buffer.name,
    isPinned: buffer.isPinned,
  };
};

const normalizeActiveSessionBuffer = (
  activeBuffer: ActiveSessionBuffer | null,
  activeBufferPath: string | null,
): { activeBuffer: ActiveSessionBuffer | null; activeBufferPath: string | null } => {
  if (activeBuffer?.kind === "agent") {
    return { activeBuffer, activeBufferPath: null };
  }

  if (activeBuffer?.kind === "file") {
    const legacyAgentSessionId = getLegacyAgentSessionId(activeBuffer.path);
    if (legacyAgentSessionId) {
      return {
        activeBuffer: { kind: "agent", sessionId: legacyAgentSessionId },
        activeBufferPath: null,
      };
    }

    return { activeBuffer, activeBufferPath: activeBuffer.path };
  }

  const legacyAgentSessionId = getLegacyAgentSessionId(activeBufferPath);
  if (legacyAgentSessionId) {
    return {
      activeBuffer: { kind: "agent", sessionId: legacyAgentSessionId },
      activeBufferPath: null,
    };
  }

  return { activeBuffer, activeBufferPath };
};

const normalizeProjectSession = (
  session: ProjectSession | null | undefined,
): ProjectSession | null => {
  if (!session) {
    return null;
  }

  const normalizedBuffers = session.buffers.map((buffer) =>
    normalizePersistedBufferSession(buffer),
  );
  const normalizedActiveBuffer = normalizeActiveSessionBuffer(
    session.activeBuffer,
    session.activeBufferPath,
  );

  return {
    ...session,
    buffers: normalizedBuffers,
    activeBuffer: normalizedActiveBuffer.activeBuffer,
    activeBufferPath: normalizedActiveBuffer.activeBufferPath,
  };
};

const normalizePersistedSessionState = (
  persistedState: PersistedSessionState | null,
): PersistedSessionState | null => {
  if (!persistedState) {
    return null;
  }

  return {
    sessions: Object.fromEntries(
      Object.entries(persistedState.sessions ?? {}).flatMap(([projectPath, session]) => {
        const normalizedSession = normalizeProjectSession(session);
        return normalizedSession ? [[projectPath, normalizedSession]] : [];
      }),
    ),
  };
};

const parsePersistedSessionState = (rawValue: string | null): PersistedSessionState | null => {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as PersistedSessionState | WrappedPersistedSessionState;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if ("state" in parsed && parsed.state) {
      return normalizePersistedSessionState(parsed.state);
    }

    return normalizePersistedSessionState(parsed as PersistedSessionState);
  } catch {
    return null;
  }
};

export const getPersistedProjectSession = (projectPath: string): ProjectSession | null => {
  try {
    const persistedState = parsePersistedSessionState(
      globalThis.localStorage?.getItem("athas-tab-sessions") ?? null,
    );
    return persistedState?.sessions?.[projectPath] ?? null;
  } catch {
    return null;
  }
};

export const getPersistedProjectSessionWithRetry = async (
  projectPath: string,
  options: {
    attempts?: number;
    delayMs?: number;
  } = {},
): Promise<ProjectSession | null> => {
  const { attempts = 5, delayMs = 50 } = options;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = getPersistedProjectSession(projectPath);
    if (session) {
      return session;
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return null;
};

const useSessionStoreBase = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: {},

      saveSession: (projectPath, buffers, activeBuffer, terminals = []) => {
        const normalizedActiveBuffer = normalizeActiveSessionBuffer(activeBuffer, null);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [projectPath]: {
              projectPath,
              activeBuffer: normalizedActiveBuffer.activeBuffer,
              activeBufferPath: normalizedActiveBuffer.activeBufferPath,
              buffers: buffers.map((buffer) => normalizePersistedBufferSession(buffer)),
              terminals,
              lastSaved: Date.now(),
            },
          },
        }));
      },

      getSession: (projectPath) => {
        return normalizeProjectSession(get().sessions[projectPath]);
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
