import { describe, expect, it } from "vitest";
import { selectMountedWorkspaceIds } from "../services/workspace-view-cache";

const eligible = ["a", "b", "c", "d", "e"];

describe("selectMountedWorkspaceIds", () => {
  it("keeps the active and most recent workspaces up to the cache limit", () => {
    expect(
      selectMountedWorkspaceIds({
        activeWorkspaceId: "d",
        recentWorkspaceIds: ["c", "b", "a"],
        eligibleWorkspaceIds: eligible,
        keepMountedWorkspaceIds: [],
      }),
    ).toEqual(["d", "c", "b"]);
  });

  it("keeps a workspace with a running agent mounted past the limit", () => {
    expect(
      selectMountedWorkspaceIds({
        activeWorkspaceId: "d",
        recentWorkspaceIds: ["c", "b", "a"],
        eligibleWorkspaceIds: eligible,
        keepMountedWorkspaceIds: ["a", "c"],
      }),
    ).toEqual(["d", "c", "b", "a"]);
  });

  it("never keeps workspaces that are not open and ready", () => {
    expect(
      selectMountedWorkspaceIds({
        activeWorkspaceId: "a",
        recentWorkspaceIds: [],
        eligibleWorkspaceIds: ["a"],
        keepMountedWorkspaceIds: ["closed", "workspace:welcome"],
      }),
    ).toEqual(["a"]);
  });
});
