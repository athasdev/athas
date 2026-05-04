import { describe, expect, it } from "vite-plus/test";
import {
  switchToNextAvailableProjectAfterClose,
  type WorkspaceProjectTabCandidate,
} from "../controllers/workspace-project-tabs";

function createActions(params: {
  tabs: WorkspaceProjectTabCandidate[];
  successfulSwitches?: Set<string>;
}) {
  const tabs = [...params.tabs];
  const successfulSwitches = params.successfulSwitches ?? new Set<string>();
  const attemptedSwitches: string[] = [];
  const activatedTabs: string[] = [];
  const removedTabs: string[] = [];
  let resetCount = 0;

  return {
    actions: {
      getProjectTabs: () => [...tabs],
      setActiveProjectTab: (projectId: string) => {
        activatedTabs.push(projectId);
      },
      removeProjectTab: (projectId: string) => {
        removedTabs.push(projectId);
        const index = tabs.findIndex((tab) => tab.id === projectId);
        if (index >= 0) {
          tabs.splice(index, 1);
        }
      },
      resetWorkspace: () => {
        resetCount += 1;
      },
      switchToProject: async (projectId: string) => {
        attemptedSwitches.push(projectId);
        return successfulSwitches.has(projectId);
      },
    },
    getResult: () => ({
      attemptedSwitches,
      activatedTabs,
      removedTabs,
      resetCount,
    }),
  };
}

describe("workspace project tab transitions", () => {
  it("uses the first active fallback project when it can be opened", async () => {
    const harness = createActions({
      tabs: [{ id: "project-b" }, { id: "project-c" }],
      successfulSwitches: new Set(["project-b"]),
    });

    await expect(
      switchToNextAvailableProjectAfterClose("project-b", harness.actions),
    ).resolves.toBe(true);
    expect(harness.getResult()).toEqual({
      attemptedSwitches: ["project-b"],
      activatedTabs: [],
      removedTabs: [],
      resetCount: 0,
    });
  });

  it("tries remaining project tabs when the first fallback fails", async () => {
    const harness = createActions({
      tabs: [{ id: "project-b" }, { id: "project-c" }],
      successfulSwitches: new Set(["project-c"]),
    });

    await expect(
      switchToNextAvailableProjectAfterClose("project-b", harness.actions),
    ).resolves.toBe(true);
    expect(harness.getResult()).toEqual({
      attemptedSwitches: ["project-b", "project-c"],
      activatedTabs: ["project-c"],
      removedTabs: [],
      resetCount: 0,
    });
  });

  it("removes stale project tabs and resets the workspace when none can be opened", async () => {
    const harness = createActions({
      tabs: [{ id: "project-b" }, { id: "project-c" }],
    });

    await expect(
      switchToNextAvailableProjectAfterClose("project-b", harness.actions),
    ).resolves.toBe(false);
    expect(harness.getResult()).toEqual({
      attemptedSwitches: ["project-b", "project-c"],
      activatedTabs: ["project-c"],
      removedTabs: ["project-b", "project-c"],
      resetCount: 1,
    });
  });
});
