// @vitest-environment jsdom
import { describe, expect, it, vi } from "vite-plus/test";
import {
  CONTINUOUS_AGENTS_STORAGE_KEY,
  syncContinuousAgentsFromStorage,
  useContinuousAgentsStore,
} from "../continuous-agents/continuous-agents.store";

function persistTasks(names: string[]) {
  localStorage.setItem(
    CONTINUOUS_AGENTS_STORAGE_KEY,
    JSON.stringify({
      version: 2,
      state: {
        tasks: names.map((name, index) => ({
          id: `task-${index}`,
          name,
          prompt: "Keep the build green.",
          agentId: "codex",
          workspacePath: "/repo",
          cadence: "hourly",
          enabled: true,
          createdAt: 1,
          nextRunAt: 2,
          lastRunAt: null,
          lastChatId: null,
          runCount: 0,
          lastError: null,
        })),
      },
    }),
  );
}

describe("syncContinuousAgentsFromStorage", () => {
  it("rehydrates only when another window changed the saved tasks", async () => {
    const rehydrate = vi.spyOn(useContinuousAgentsStore.persist, "rehydrate");

    persistTasks(["Nightly tests"]);
    await syncContinuousAgentsFromStorage();
    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(useContinuousAgentsStore.getState().tasks.map((task) => task.name)).toEqual([
      "Nightly tests",
    ]);

    const tasks = useContinuousAgentsStore.getState().tasks;
    await syncContinuousAgentsFromStorage();
    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(useContinuousAgentsStore.getState().tasks).toBe(tasks);

    persistTasks(["Nightly tests", "Dependency audit"]);
    await syncContinuousAgentsFromStorage();
    expect(rehydrate).toHaveBeenCalledTimes(2);
    expect(useContinuousAgentsStore.getState().tasks.map((task) => task.name)).toEqual([
      "Nightly tests",
      "Dependency audit",
    ]);
  });
});
