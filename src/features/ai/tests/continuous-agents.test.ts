import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  formatContinuousAgentRunTime,
  getNextContinuousAgentRunAt,
} from "../continuous-agents/continuous-agent-schedule";
import {
  normalizePersistedContinuousAgentTasks,
  selectNextDueContinuousAgent,
  useContinuousAgentsStore,
} from "../continuous-agents/continuous-agents.store";

describe("continuous agents", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useContinuousAgentsStore.setState({ tasks: [] });
  });

  it("calculates and describes the next cadence", () => {
    const now = Date.UTC(2026, 8, 2, 12, 0, 0);

    expect(getNextContinuousAgentRunAt("15m", now)).toBe(now + 15 * 60_000);
    expect(getNextContinuousAgentRunAt("hourly", now)).toBe(now + 60 * 60_000);
    expect(getNextContinuousAgentRunAt("4h", now)).toBe(now + 4 * 60 * 60_000);
    expect(getNextContinuousAgentRunAt("daily", now)).toBe(now + 24 * 60 * 60_000);
    expect(formatContinuousAgentRunTime(now, now)).toBe("Ready now");
    expect(formatContinuousAgentRunTime(now + 45 * 60_000, now)).toBe("in 45m");
    expect(formatContinuousAgentRunTime(now + 90 * 60_000, now)).toBe("in 2h");
  });

  it("creates an immediate first run and advances from the claim time", () => {
    const createdAt = Date.UTC(2026, 8, 2, 12, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(createdAt);
    const actions = useContinuousAgentsStore.getState().actions;
    const taskId = actions.createTask({
      name: "Keep tests green",
      prompt: "Run tests and fix regressions.",
      agentId: "codex",
      workspacePath: "/repo",
      cadence: "hourly",
    });

    expect(useContinuousAgentsStore.getState().tasks[0]).toMatchObject({
      id: taskId,
      enabled: true,
      nextRunAt: createdAt,
      lastRunAt: null,
      runCount: 0,
      lastError: null,
    });

    const claimedAt = createdAt + 5_000;
    expect(actions.claimDueTask("/other", claimedAt)).toBeNull();
    expect(actions.claimDueTask("/repo", claimedAt)).toMatchObject({
      id: taskId,
      lastRunAt: claimedAt,
      nextRunAt: claimedAt + 60 * 60_000,
      runCount: 1,
    });
    expect(actions.claimDueTask("/repo", claimedAt)).toBeNull();
  });

  it("pauses, resumes, and requests a manual run without losing history", () => {
    const now = Date.UTC(2026, 8, 2, 12, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const actions = useContinuousAgentsStore.getState().actions;
    const taskId = actions.createTask({
      name: "Review dependencies",
      prompt: "Check dependency health.",
      agentId: "codex",
      workspacePath: "/repo",
      cadence: "daily",
    });

    actions.attachChat(taskId, "chat-1");
    actions.pauseTaskForError(taskId, "Codex is unavailable");
    expect(useContinuousAgentsStore.getState().tasks[0]).toMatchObject({
      enabled: false,
      lastChatId: "chat-1",
      lastError: "Codex is unavailable",
    });

    actions.setTaskEnabled(taskId, false);
    expect(useContinuousAgentsStore.getState().tasks[0]).toMatchObject({
      enabled: false,
      lastChatId: "chat-1",
    });

    actions.setTaskEnabled(taskId, true);
    expect(useContinuousAgentsStore.getState().tasks[0]).toMatchObject({
      nextRunAt: now + 24 * 60 * 60_000,
      lastError: null,
    });

    actions.requestTaskRun(taskId);
    expect(useContinuousAgentsStore.getState().tasks[0]).toMatchObject({
      enabled: true,
      nextRunAt: now,
      lastChatId: "chat-1",
      lastError: null,
    });
  });

  it("selects only the earliest due task in the active workspace", () => {
    const now = Date.UTC(2026, 8, 2, 12, 0, 0);
    const baseTask = {
      id: "later",
      name: "Later",
      prompt: "Run later",
      agentId: "codex",
      workspacePath: "/repo",
      cadence: "hourly" as const,
      enabled: true,
      createdAt: now,
      nextRunAt: now - 1_000,
      lastRunAt: null,
      lastChatId: null,
      runCount: 0,
      lastError: null,
    };

    expect(
      selectNextDueContinuousAgent(
        [
          baseTask,
          { ...baseTask, id: "other", workspacePath: "/other", nextRunAt: now - 10_000 },
          { ...baseTask, id: "paused", enabled: false, nextRunAt: now - 20_000 },
          { ...baseTask, id: "earliest", nextRunAt: now - 5_000 },
        ],
        "/repo",
        now,
      ),
    ).toMatchObject({ id: "earliest" });
  });

  it("rejects incomplete tasks and drops corrupt or duplicate persisted records", () => {
    const actions = useContinuousAgentsStore.getState().actions;
    expect(() =>
      actions.createTask({
        name: "",
        prompt: "Do work",
        agentId: "codex",
        workspacePath: "/repo",
        cadence: "hourly",
      }),
    ).toThrow("names must be between");

    const validTask = {
      id: "valid",
      name: "Valid task",
      prompt: "Do safe work",
      agentId: "codex",
      workspacePath: "/repo",
      cadence: "hourly",
      enabled: true,
      createdAt: 1,
      nextRunAt: 2,
      lastRunAt: null,
      lastChatId: null,
      runCount: 0,
    };
    expect(
      normalizePersistedContinuousAgentTasks([
        validTask,
        { ...validTask, name: "Duplicate" },
        { ...validTask, id: "bad-time", nextRunAt: Number.NaN },
        { ...validTask, id: "no-workspace", workspacePath: null },
      ]),
    ).toEqual([{ ...validTask, lastError: null }]);
  });
});
