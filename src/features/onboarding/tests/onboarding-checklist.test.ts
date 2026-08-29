import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  getOnboardingChecklistProgress,
  isOnboardingChecklistTaskId,
  ONBOARDING_CHECKLIST_TASKS,
} from "../lib/onboarding-checklist";
import { useOnboardingChecklistStore } from "../stores/onboarding-checklist.store";

describe("onboarding checklist", () => {
  beforeEach(() => {
    useOnboardingChecklistStore.setState({ completedTaskIds: [] });
  });

  it("keeps the starter actions concise and ordered", () => {
    expect(ONBOARDING_CHECKLIST_TASKS).toEqual([
      { id: "open-project", label: "Open a project" },
      { id: "start-agent", label: "Try the Agent" },
      { id: "open-terminal", label: "Open a terminal" },
      { id: "open-command-palette", label: "Find a command" },
      { id: "open-settings", label: "Customize Athas" },
    ]);
  });

  it("tracks monotonic, idempotent progress", () => {
    const actions = useOnboardingChecklistStore.getState().actions;

    actions.completeTask("open-project");
    actions.completeTask("open-project");
    actions.completeTask("start-agent");

    expect(useOnboardingChecklistStore.getState().completedTaskIds).toEqual([
      "open-project",
      "start-agent",
    ]);
    expect(
      getOnboardingChecklistProgress(useOnboardingChecklistStore.getState().completedTaskIds),
    ).toEqual({
      completedCount: 2,
      totalCount: 5,
      percentage: 40,
      complete: false,
    });
  });

  it("reports completion after every starter action is done", () => {
    expect(
      getOnboardingChecklistProgress(ONBOARDING_CHECKLIST_TASKS.map((task) => task.id)),
    ).toEqual({
      completedCount: 5,
      totalCount: 5,
      percentage: 100,
      complete: true,
    });
  });

  it("rejects unknown persisted task IDs", () => {
    expect(isOnboardingChecklistTaskId("open-terminal")).toBe(true);
    expect(isOnboardingChecklistTaskId("legacy-task")).toBe(false);
    expect(isOnboardingChecklistTaskId(null)).toBe(false);
  });
});
