import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import {
  getNextContinuousAgentRunAt,
  isContinuousAgentCadence,
  type ContinuousAgentCadence,
} from "./continuous-agent-schedule";

export interface ContinuousAgentTask {
  id: string;
  name: string;
  prompt: string;
  agentId: AgentType;
  workspacePath: string;
  cadence: ContinuousAgentCadence;
  enabled: boolean;
  createdAt: number;
  nextRunAt: number;
  lastRunAt: number | null;
  lastChatId: string | null;
  runCount: number;
  lastError: string | null;
}

interface CreateContinuousAgentTaskInput {
  name: string;
  prompt: string;
  agentId: AgentType;
  workspacePath: string;
  cadence: ContinuousAgentCadence;
}

interface ContinuousAgentsState {
  tasks: ContinuousAgentTask[];
  actions: {
    createTask: (input: CreateContinuousAgentTaskInput) => string;
    deleteTask: (taskId: string) => void;
    setTaskEnabled: (taskId: string, enabled: boolean) => void;
    requestTaskRun: (taskId: string) => void;
    claimDueTask: (
      workspacePath: string,
      now?: number,
      expectedTaskId?: string,
    ) => ContinuousAgentTask | null;
    attachChat: (taskId: string, chatId: string) => void;
    pauseTaskForError: (taskId: string, reason: string) => void;
  };
}

type PersistedContinuousAgentsState = Pick<ContinuousAgentsState, "tasks">;

function createTaskId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `continuous-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}

export const CONTINUOUS_AGENT_NAME_MAX_LENGTH = 80;
export const CONTINUOUS_AGENT_PROMPT_MAX_LENGTH = 20_000;

function normalizePersistedTask(value: unknown): ContinuousAgentTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<ContinuousAgentTask>;
  const id = typeof task.id === "string" ? task.id.trim() : "";
  const name = typeof task.name === "string" ? task.name.trim() : "";
  const prompt = typeof task.prompt === "string" ? task.prompt.trim() : "";
  const agentId = typeof task.agentId === "string" ? task.agentId.trim() : "";
  const workspacePath = typeof task.workspacePath === "string" ? task.workspacePath.trim() : "";
  if (
    !id ||
    !name ||
    name.length > CONTINUOUS_AGENT_NAME_MAX_LENGTH ||
    !prompt ||
    prompt.length > CONTINUOUS_AGENT_PROMPT_MAX_LENGTH ||
    !agentId ||
    !workspacePath ||
    !isContinuousAgentCadence(task.cadence) ||
    typeof task.enabled !== "boolean" ||
    typeof task.createdAt !== "number" ||
    !Number.isFinite(task.createdAt) ||
    typeof task.nextRunAt !== "number" ||
    !Number.isFinite(task.nextRunAt) ||
    (task.lastRunAt !== null && typeof task.lastRunAt !== "number") ||
    (typeof task.lastRunAt === "number" && !Number.isFinite(task.lastRunAt)) ||
    (task.lastChatId !== null && typeof task.lastChatId !== "string") ||
    typeof task.runCount !== "number" ||
    !Number.isSafeInteger(task.runCount) ||
    (task.runCount ?? -1) < 0
  ) {
    return null;
  }

  return {
    id,
    name,
    prompt,
    agentId,
    workspacePath,
    cadence: task.cadence,
    enabled: task.enabled,
    createdAt: task.createdAt,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastChatId: task.lastChatId,
    runCount: task.runCount,
    lastError: typeof task.lastError === "string" ? task.lastError.trim() || null : null,
  };
}

export function normalizePersistedContinuousAgentTasks(value: unknown): ContinuousAgentTask[] {
  if (!Array.isArray(value)) return [];
  const taskIds = new Set<string>();
  const tasks: ContinuousAgentTask[] = [];
  for (const valueTask of value) {
    const task = normalizePersistedTask(valueTask);
    if (!task || taskIds.has(task.id)) continue;
    taskIds.add(task.id);
    tasks.push(task);
  }
  return tasks;
}

export function selectNextDueContinuousAgent(
  tasks: ContinuousAgentTask[],
  workspacePath: string,
  now = Date.now(),
): ContinuousAgentTask | null {
  return (
    tasks
      .filter(
        (task) => task.enabled && task.workspacePath === workspacePath && task.nextRunAt <= now,
      )
      .sort((left, right) => left.nextRunAt - right.nextRunAt)[0] ?? null
  );
}

const useContinuousAgentsStoreBase = create<ContinuousAgentsState>()(
  persist(
    (set) => ({
      tasks: [],
      actions: {
        createTask: (input) => {
          const name = input.name.trim().replace(/\s+/g, " ");
          const prompt = input.prompt.trim();
          const agentId = input.agentId.trim();
          const workspacePath = input.workspacePath.trim();
          if (!name || name.length > CONTINUOUS_AGENT_NAME_MAX_LENGTH) {
            throw new Error("Continuous agent names must be between 1 and 80 characters.");
          }
          if (!prompt || prompt.length > CONTINUOUS_AGENT_PROMPT_MAX_LENGTH) {
            throw new Error("Continuous agent goals must be between 1 and 20,000 characters.");
          }
          if (!agentId || !workspacePath || !isContinuousAgentCadence(input.cadence)) {
            throw new Error("Continuous agent configuration is incomplete.");
          }
          const id = createTaskId();
          const createdAt = Date.now();
          const task: ContinuousAgentTask = {
            id,
            name,
            prompt,
            agentId,
            workspacePath,
            cadence: input.cadence,
            enabled: true,
            createdAt,
            nextRunAt: createdAt,
            lastRunAt: null,
            lastChatId: null,
            runCount: 0,
            lastError: null,
          };
          set((state) => ({ tasks: [task, ...state.tasks] }));
          return id;
        },
        deleteTask: (taskId) =>
          set((state) => ({ tasks: state.tasks.filter((task) => task.id !== taskId) })),
        setTaskEnabled: (taskId, enabled) => {
          const now = Date.now();
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    enabled,
                    lastError: enabled ? null : task.lastError,
                    nextRunAt: enabled
                      ? getNextContinuousAgentRunAt(task.cadence, now)
                      : task.nextRunAt,
                  }
                : task,
            ),
          }));
        },
        requestTaskRun: (taskId) =>
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === taskId
                ? { ...task, enabled: true, nextRunAt: Date.now(), lastError: null }
                : task,
            ),
          })),
        claimDueTask: (workspacePath, now = Date.now(), expectedTaskId) => {
          let claimedTask: ContinuousAgentTask | null = null;
          set((state) => {
            const dueTask = selectNextDueContinuousAgent(state.tasks, workspacePath, now);
            if (!dueTask) return state;
            if (expectedTaskId && dueTask.id !== expectedTaskId) return state;

            claimedTask = {
              ...dueTask,
              lastRunAt: now,
              nextRunAt: getNextContinuousAgentRunAt(dueTask.cadence, now),
              runCount: dueTask.runCount + 1,
              lastError: null,
            };
            return {
              tasks: state.tasks.map((task) =>
                task.id === dueTask.id ? (claimedTask as ContinuousAgentTask) : task,
              ),
            };
          });
          return claimedTask;
        },
        attachChat: (taskId, chatId) =>
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === taskId ? { ...task, lastChatId: chatId } : task,
            ),
          })),
        pauseTaskForError: (taskId, reason) =>
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === taskId
                ? { ...task, enabled: false, lastError: reason.trim() || "Unable to start agent." }
                : task,
            ),
          })),
      },
    }),
    {
      name: "athas-continuous-agents-v1",
      version: 2,
      storage: createSafeJSONStorage<PersistedContinuousAgentsState>(),
      partialize: (state) => ({ tasks: state.tasks }),
      migrate: (persistedState) => {
        const persisted = persistedState as Partial<PersistedContinuousAgentsState> | undefined;
        return { tasks: normalizePersistedContinuousAgentTasks(persisted?.tasks) };
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PersistedContinuousAgentsState> | undefined;
        return {
          ...currentState,
          tasks: normalizePersistedContinuousAgentTasks(persisted?.tasks),
        };
      },
    },
  ),
);

export const useContinuousAgentsStore = createSelectors(useContinuousAgentsStoreBase);
