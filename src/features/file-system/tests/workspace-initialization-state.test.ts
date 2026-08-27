import { describe, expect, it, vi } from "vite-plus/test";
import { applyWorkspaceInitializationState } from "../services/workspace-initialization-state";

const workspace = {
  path: "remote://connection-1/",
  name: "Production",
  files: [
    {
      name: "Production",
      path: "remote://connection-1/",
      isDir: true,
      children: [],
    },
  ],
};

function createActions(activeProjectId: string | undefined) {
  const events: string[] = [];

  return {
    events,
    actions: {
      addProjectTab: vi.fn((path: string, name: string) => {
        events.push(`add-tab:${path}:${name}`);
      }),
      getActiveProjectTabId: vi.fn(() => {
        events.push("read-active-tab");
        return activeProjectId;
      }),
      expandRoot: vi.fn((path: string) => {
        events.push(`expand:${path}`);
      }),
      setProjectMetadata: vi.fn((path: string, name: string, projectId: string | undefined) => {
        events.push(`metadata:${path}:${name}:${projectId ?? "none"}`);
      }),
      restoreUiState: vi.fn((path: string) => {
        events.push(`restore-ui:${path}`);
      }),
      commitFileSystemState: vi.fn(() => {
        events.push("commit-file-system");
      }),
    },
  };
}

describe("workspace initialization state", () => {
  it("applies prepared workspace state in cross-store lifecycle order", () => {
    const harness = createActions("workspace:remote");

    expect(applyWorkspaceInitializationState(workspace, harness.actions)).toBe("workspace:remote");
    expect(harness.actions.commitFileSystemState).toHaveBeenCalledWith(workspace);
    expect(harness.events).toEqual([
      "add-tab:remote://connection-1/:Production",
      "read-active-tab",
      "expand:remote://connection-1/",
      "metadata:remote://connection-1/:Production:workspace:remote",
      "restore-ui:remote://connection-1/",
      "commit-file-system",
    ]);
  });

  it("still applies workspace state when no active tab id is available", () => {
    const harness = createActions(undefined);

    expect(applyWorkspaceInitializationState(workspace, harness.actions)).toBeUndefined();
    expect(harness.actions.setProjectMetadata).toHaveBeenCalledWith(
      workspace.path,
      workspace.name,
      undefined,
    );
    expect(harness.actions.commitFileSystemState).toHaveBeenCalledWith(workspace);
  });
});
