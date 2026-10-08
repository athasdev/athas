import { describe, expect, it } from "vite-plus/test";
import type { ProjectTab } from "../stores/workspace-tabs.store";
import { renameRemoteProjectTabs } from "../utils/project-tab-remote";

const createProjectTab = (overrides: Partial<ProjectTab>): ProjectTab => ({
  id: "tab-1",
  name: "Project",
  path: "/workspace",
  isActive: false,
  lastOpened: 1000,
  ...overrides,
});

describe("remote project tab helpers", () => {
  it("renames only tabs for the matching remote connection", () => {
    const tabs = [
      createProjectTab({
        id: "remote-1",
        name: "Old Server",
        path: "remote://conn-1/",
      }),
      createProjectTab({
        id: "remote-2",
        name: "Other Server",
        path: "remote://conn-2/",
      }),
      createProjectTab({
        id: "local",
        name: "Local",
        path: "/workspace",
      }),
    ];

    expect(renameRemoteProjectTabs(tabs, "conn-1", "New Server")).toEqual([
      {
        ...tabs[0],
        name: "New Server",
      },
      tabs[1],
      tabs[2],
    ]);
  });

  it("preserves object identity when the remote tab already has the latest name", () => {
    const tab = createProjectTab({
      name: "Server",
      path: "remote://conn-1/",
    });

    expect(renameRemoteProjectTabs([tab], "conn-1", "Server")[0]).toBe(tab);
  });
});
