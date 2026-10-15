import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";
import type { CloudAgentLogLine } from "../services/cloud-agents-api";
import {
  type AgentEnvironmentKind,
  DEFAULT_CLOUD_MAX_MINUTES,
} from "../services/cloud-environment";

/** The environment picked in a composer that has no session yet. */
export interface CloudEnvironmentDraft {
  kind: AgentEnvironmentKind;
  repo: string | null;
  branch: string | null;
}

export interface CloudRunLog {
  lines: CloudAgentLogLine[];
  cursor: number;
  /** At least one read finished. */
  loaded: boolean;
  error: string | null;
}

export interface CloudAgentPreferences {
  /** Runs use the user's own Anthropic or OpenAI key instead of Athas credit. */
  useOwnKey: boolean;
  maxMinutes: number;
}

interface CloudEnvironmentState {
  drafts: Record<string, CloudEnvironmentDraft>;
  /** Each run's log as read so far, by run id; kept for the session, never saved. */
  logs: Record<string, CloudRunLog>;
  preferences: CloudAgentPreferences;
  actions: {
    updateDraft: (key: string, patch: Partial<CloudEnvironmentDraft>) => void;
    appendLog: (runId: string, lines: CloudAgentLogLine[], cursor: number) => void;
    setLogError: (runId: string, error: string | null) => void;
    setPreferences: (patch: Partial<CloudAgentPreferences>) => void;
  };
}

export const EMPTY_CLOUD_DRAFT: CloudEnvironmentDraft = { kind: "local", repo: null, branch: null };
const EMPTY_LOG: CloudRunLog = { lines: [], cursor: 0, loaded: false, error: null };

const useCloudEnvironmentStoreBase = create<CloudEnvironmentState>()(
  persist(
    (set) => ({
      drafts: {},
      logs: {},
      preferences: { useOwnKey: false, maxMinutes: DEFAULT_CLOUD_MAX_MINUTES },
      actions: {
        updateDraft: (key, patch) =>
          set((state) => ({
            drafts: {
              ...state.drafts,
              [key]: { ...(state.drafts[key] ?? EMPTY_CLOUD_DRAFT), ...patch },
            },
          })),
        appendLog: (runId, lines, cursor) =>
          set((state) => {
            const current = state.logs[runId] ?? EMPTY_LOG;
            return {
              logs: {
                ...state.logs,
                [runId]: {
                  lines: lines.length ? [...current.lines, ...lines] : current.lines,
                  cursor,
                  loaded: true,
                  error: null,
                },
              },
            };
          }),
        setLogError: (runId, error) =>
          set((state) => ({
            logs: { ...state.logs, [runId]: { ...(state.logs[runId] ?? EMPTY_LOG), error } },
          })),
        setPreferences: (patch) =>
          set((state) => ({ preferences: { ...state.preferences, ...patch } })),
      },
    }),
    {
      name: "athas-cloud-agents-v1",
      version: 1,
      storage: createSafeJSONStorage(),
      partialize: (state) => ({ preferences: state.preferences }) as CloudEnvironmentState,
      merge: (persisted, current) => ({
        ...current,
        preferences: {
          ...current.preferences,
          ...(persisted as Partial<CloudEnvironmentState> | undefined)?.preferences,
        },
      }),
    },
  ),
);

export const useCloudEnvironmentStore = createSelectors(useCloudEnvironmentStoreBase);

export function selectCloudRunLog(
  state: Pick<CloudEnvironmentState, "logs">,
  runId: string | null,
) {
  return (runId ? state.logs[runId] : undefined) ?? EMPTY_LOG;
}
