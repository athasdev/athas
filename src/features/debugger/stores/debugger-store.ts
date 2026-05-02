import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import type {
  DebugBreakpoint,
  DebugLaunchConfig,
  DebugProcessOutput,
  DebugProtocolMessage,
  DebugRequestContext,
  DebugScope,
  DebugSession,
  DebugSessionEnded,
  DebugStackFrame,
  DebugStoppedState,
  DebugThread,
  DebugVariable,
  DebugWatchExpression,
  DebugWatchResult,
} from "@/features/debugger/types/debugger";

const BREAKPOINTS_STORAGE_KEY = "athas-debugger-breakpoints";
const USER_CONFIGS_STORAGE_KEY = "athas-debugger-user-configs";
const WATCH_EXPRESSIONS_STORAGE_KEY = "athas-debugger-watch-expressions";

interface DebuggerState {
  breakpoints: DebugBreakpoint[];
  watchExpressions: DebugWatchExpression[];
  watchResults: Record<string, DebugWatchResult>;
  workspaceConfigs: DebugLaunchConfig[];
  userConfigs: DebugLaunchConfig[];
  activeConfigId: string | null;
  activeSession: DebugSession | null;
  adapterMessages: DebugProtocolMessage[];
  adapterOutput: DebugProcessOutput[];
  endedSessions: DebugSessionEnded[];
  threads: DebugThread[];
  stackFrames: DebugStackFrame[];
  selectedFrameId: number | null;
  scopes: DebugScope[];
  variablesByReference: Record<number, DebugVariable[]>;
  stoppedState: DebugStoppedState | null;
  pendingRequests: Record<number, DebugRequestContext>;
  actions: {
    hydrate: () => void;
    setWorkspaceConfigs: (configs: DebugLaunchConfig[]) => void;
    setActiveConfigId: (configId: string | null) => void;
    toggleBreakpoint: (filePath: string, line: number) => void;
    setBreakpointEnabled: (breakpointId: string, enabled: boolean) => void;
    removeBreakpoint: (breakpointId: string) => void;
    clearBreakpoints: () => void;
    addWatchExpression: (expression: string) => DebugWatchExpression | null;
    updateWatchExpression: (expressionId: string, expression: string) => void;
    removeWatchExpression: (expressionId: string) => void;
    clearWatchExpressions: () => void;
    setWatchResult: (result: DebugWatchResult) => void;
    clearWatchResults: () => void;
    startSession: (session: DebugSession) => void;
    stopSession: () => void;
    setSessionStatus: (status: DebugSession["status"]) => void;
    recordAdapterMessage: (message: DebugProtocolMessage) => void;
    recordAdapterOutput: (output: DebugProcessOutput) => void;
    recordSessionEnded: (event: DebugSessionEnded) => void;
    registerAdapterRequest: (seq: number, context: DebugRequestContext) => void;
    clearAdapterRequest: (seq: number) => void;
    setThreads: (threads: DebugThread[]) => void;
    setStackFrames: (frames: DebugStackFrame[]) => void;
    selectStackFrame: (frameId: number | null) => void;
    setScopes: (scopes: DebugScope[]) => void;
    setVariables: (variablesReference: number, variables: DebugVariable[]) => void;
    setStoppedState: (stoppedState: DebugStoppedState | null) => void;
    clearAdapterTranscript: () => void;
    getBreakpointsForFile: (filePath: string) => DebugBreakpoint[];
  };
}

const loadBreakpoints = (): DebugBreakpoint[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(BREAKPOINTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is DebugBreakpoint =>
        item &&
        typeof item.id === "string" &&
        typeof item.filePath === "string" &&
        typeof item.line === "number" &&
        typeof item.enabled === "boolean" &&
        typeof item.createdAt === "number",
    );
  } catch {
    return [];
  }
};

const loadUserConfigs = (): DebugLaunchConfig[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(USER_CONFIGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DebugLaunchConfig[];
  } catch {
    return [];
  }
};

const loadWatchExpressions = (): DebugWatchExpression[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(WATCH_EXPRESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is DebugWatchExpression =>
        item &&
        typeof item.id === "string" &&
        typeof item.expression === "string" &&
        typeof item.createdAt === "number",
    );
  } catch {
    return [];
  }
};

const saveBreakpoints = (breakpoints: DebugBreakpoint[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BREAKPOINTS_STORAGE_KEY, JSON.stringify(breakpoints));
};

const saveWatchExpressions = (watchExpressions: DebugWatchExpression[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WATCH_EXPRESSIONS_STORAGE_KEY, JSON.stringify(watchExpressions));
};

const createBreakpointId = (filePath: string, line: number) =>
  `bp_${filePath.replace(/[^a-zA-Z0-9]/g, "_")}_${line}`;

const createWatchExpressionId = () => `watch_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const useDebuggerStore = createSelectors(
  create<DebuggerState>()((set, get) => ({
    breakpoints: loadBreakpoints(),
    watchExpressions: loadWatchExpressions(),
    watchResults: {},
    workspaceConfigs: [],
    userConfigs: loadUserConfigs(),
    activeConfigId: null,
    activeSession: null,
    adapterMessages: [],
    adapterOutput: [],
    endedSessions: [],
    threads: [],
    stackFrames: [],
    selectedFrameId: null,
    scopes: [],
    variablesByReference: {},
    stoppedState: null,
    pendingRequests: {},
    actions: {
      hydrate: () => {
        set({
          breakpoints: loadBreakpoints(),
          userConfigs: loadUserConfigs(),
          watchExpressions: loadWatchExpressions(),
        });
      },

      setWorkspaceConfigs: (configs) => {
        set({ workspaceConfigs: configs });
      },

      setActiveConfigId: (configId) => {
        set({ activeConfigId: configId });
      },

      toggleBreakpoint: (filePath, line) => {
        set((state) => {
          const existing = state.breakpoints.find(
            (breakpoint) => breakpoint.filePath === filePath && breakpoint.line === line,
          );

          const nextBreakpoints = existing
            ? state.breakpoints.filter((breakpoint) => breakpoint.id !== existing.id)
            : [
                ...state.breakpoints,
                {
                  id: createBreakpointId(filePath, line),
                  filePath,
                  line,
                  enabled: true,
                  createdAt: Date.now(),
                },
              ];

          saveBreakpoints(nextBreakpoints);
          return { breakpoints: nextBreakpoints };
        });
      },

      setBreakpointEnabled: (breakpointId, enabled) => {
        set((state) => {
          const nextBreakpoints = state.breakpoints.map((breakpoint) =>
            breakpoint.id === breakpointId ? { ...breakpoint, enabled } : breakpoint,
          );
          saveBreakpoints(nextBreakpoints);
          return { breakpoints: nextBreakpoints };
        });
      },

      removeBreakpoint: (breakpointId) => {
        set((state) => {
          const nextBreakpoints = state.breakpoints.filter(
            (breakpoint) => breakpoint.id !== breakpointId,
          );
          saveBreakpoints(nextBreakpoints);
          return { breakpoints: nextBreakpoints };
        });
      },

      clearBreakpoints: () => {
        saveBreakpoints([]);
        set({ breakpoints: [] });
      },

      addWatchExpression: (expression) => {
        const trimmedExpression = expression.trim();
        if (!trimmedExpression) return null;

        const watchExpression = {
          id: createWatchExpressionId(),
          expression: trimmedExpression,
          createdAt: Date.now(),
        };

        set((state) => {
          const nextWatchExpressions = [...state.watchExpressions, watchExpression];
          saveWatchExpressions(nextWatchExpressions);
          return { watchExpressions: nextWatchExpressions };
        });

        return watchExpression;
      },

      updateWatchExpression: (expressionId, expression) => {
        const trimmedExpression = expression.trim();
        if (!trimmedExpression) return;

        set((state) => {
          const nextWatchExpressions = state.watchExpressions.map((watchExpression) =>
            watchExpression.id === expressionId
              ? { ...watchExpression, expression: trimmedExpression }
              : watchExpression,
          );
          saveWatchExpressions(nextWatchExpressions);
          return { watchExpressions: nextWatchExpressions };
        });
      },

      removeWatchExpression: (expressionId) => {
        set((state) => {
          const nextWatchExpressions = state.watchExpressions.filter(
            (watchExpression) => watchExpression.id !== expressionId,
          );
          const nextWatchResults = { ...state.watchResults };
          delete nextWatchResults[expressionId];
          saveWatchExpressions(nextWatchExpressions);
          return {
            watchExpressions: nextWatchExpressions,
            watchResults: nextWatchResults,
          };
        });
      },

      clearWatchExpressions: () => {
        saveWatchExpressions([]);
        set({ watchExpressions: [], watchResults: {} });
      },

      setWatchResult: (result) => {
        set((state) => ({
          watchResults: {
            ...state.watchResults,
            [result.expressionId]: result,
          },
        }));
      },

      clearWatchResults: () => {
        set({ watchResults: {} });
      },

      startSession: (session) => {
        set({
          activeSession: session,
          threads: [],
          stackFrames: [],
          selectedFrameId: null,
          scopes: [],
          variablesByReference: {},
          watchResults: {},
          stoppedState: null,
          pendingRequests: {},
        });
      },

      stopSession: () => {
        set((state) => ({
          activeSession: state.activeSession
            ? { ...state.activeSession, status: "idle" }
            : state.activeSession,
        }));
      },

      setSessionStatus: (status) => {
        set((state) => ({
          activeSession: state.activeSession ? { ...state.activeSession, status } : null,
        }));
      },

      recordAdapterMessage: (message) => {
        set((state) => ({
          adapterMessages: [...state.adapterMessages.slice(-499), message],
        }));
      },

      recordAdapterOutput: (output) => {
        set((state) => ({
          adapterOutput: [...state.adapterOutput.slice(-499), output],
        }));
      },

      recordSessionEnded: (event) => {
        set((state) => ({
          endedSessions: [...state.endedSessions.slice(-99), event],
          activeSession:
            state.activeSession?.id === event.sessionId
              ? { ...state.activeSession, status: "idle" }
              : state.activeSession,
          stoppedState: null,
          watchResults: {},
        }));
      },

      registerAdapterRequest: (seq, context) => {
        set((state) => ({
          pendingRequests: {
            ...state.pendingRequests,
            [seq]: context,
          },
        }));
      },

      clearAdapterRequest: (seq) => {
        set((state) => {
          const nextPendingRequests = { ...state.pendingRequests };
          delete nextPendingRequests[seq];
          return { pendingRequests: nextPendingRequests };
        });
      },

      setThreads: (threads) => {
        set({ threads });
      },

      setStackFrames: (stackFrames) => {
        set({
          stackFrames,
          selectedFrameId: stackFrames[0]?.id ?? null,
        });
      },

      selectStackFrame: (frameId) => {
        set({ selectedFrameId: frameId });
      },

      setScopes: (scopes) => {
        set({ scopes });
      },

      setVariables: (variablesReference, variables) => {
        set((state) => ({
          variablesByReference: {
            ...state.variablesByReference,
            [variablesReference]: variables,
          },
        }));
      },

      setStoppedState: (stoppedState) => {
        set({ stoppedState });
      },

      clearAdapterTranscript: () => {
        set({
          adapterMessages: [],
          adapterOutput: [],
          endedSessions: [],
          pendingRequests: {},
        });
      },

      getBreakpointsForFile: (filePath) => {
        return get().breakpoints.filter((breakpoint) => breakpoint.filePath === filePath);
      },
    },
  })),
);
