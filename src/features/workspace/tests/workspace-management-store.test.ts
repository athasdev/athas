import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const io = vi.hoisted(() => ({ readTeamWorkspaceContent: vi.fn(), saveTeamWorkspace: vi.fn() }));
vi.mock("../team/services/team-workspace-service", () => io);
import { useWorkspaceManagementStore } from "../team/stores/workspace-management.store";
const config = { version: 1, name: "Team", instructions: "Use Bun", commands: [] };
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceManagementStore.setState({
    roots: [],
    selectedRoot: null,
    drafts: {},
    bindings: {},
    section: "overview",
  });
  io.readTeamWorkspaceContent.mockResolvedValue(JSON.stringify(config));
  io.saveTeamWorkspace.mockResolvedValue(undefined);
});
describe("workspace management", () => {
  it("keeps independent drafts across workspace and section changes", async () => {
    const { register, load, update, select, setSection } =
      useWorkspaceManagementStore.getState().actions;
    register("/one/");
    register("/one");
    expect(useWorkspaceManagementStore.getState().roots).toEqual(["/one"]);
    await load("/one");
    await load("/two");
    update("/one", {
      ...useWorkspaceManagementStore.getState().drafts["/one"]!.config,
      name: "Changed",
    });
    select("/two");
    setSection("tasks");
    await load("/one");
    expect(useWorkspaceManagementStore.getState().drafts["/one"]!.config.name).toBe("Changed");
    expect(useWorkspaceManagementStore.getState().drafts["/two"]!.config.name).toBe("Team");
  });
  it("retains unsaved changes when the disk version conflicts", async () => {
    const { load, update, save } = useWorkspaceManagementStore.getState().actions;
    await load("/one");
    update("/one", {
      ...useWorkspaceManagementStore.getState().drafts["/one"]!.config,
      name: "Changed",
    });
    io.saveTeamWorkspace.mockRejectedValue(new Error("changed on disk"));
    await save("/one");
    const draft = useWorkspaceManagementStore.getState().drafts["/one"]!;
    expect(draft.config.name).toBe("Changed");
    expect(draft.error).toBe("changed on disk");
    expect(draft.saving).toBe(false);
    expect(JSON.stringify(draft.config)).not.toBe(draft.saved);
  });
  it("saves one workspace even if selection changes while saving", async () => {
    const { load, save, select } = useWorkspaceManagementStore.getState().actions;
    await load("/one");
    let finish: () => void = () => {};
    io.saveTeamWorkspace.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = save("/one");
    select("/two");
    finish();
    await saving;
    expect(io.saveTeamWorkspace).toHaveBeenCalledWith("/one", config, JSON.stringify(config));
    expect(useWorkspaceManagementStore.getState().selectedRoot).toBe("/two");
    expect(useWorkspaceManagementStore.getState().drafts["/one"]!.saving).toBe(false);
  });
  it("keeps machine paths out of the saved team profile", async () => {
    const { load, bindRepository, save } = useWorkspaceManagementStore.getState().actions;
    await load("/one");
    bindRepository("/one", "web", "/Users/local/private-project");
    await save("/one");
    expect(JSON.stringify(io.saveTeamWorkspace.mock.calls)).not.toContain("private-project");
    expect(useWorkspaceManagementStore.getState().bindings["/one"]?.web).toBe(
      "/Users/local/private-project",
    );
  });
  it("reloads explicitly rather than replacing edits on remount", async () => {
    const { load, update } = useWorkspaceManagementStore.getState().actions;
    await load("/one");
    update("/one", {
      ...useWorkspaceManagementStore.getState().drafts["/one"]!.config,
      name: "Draft",
    });
    await load("/one");
    expect(useWorkspaceManagementStore.getState().drafts["/one"]!.config.name).toBe("Draft");
    await load("/one", true);
    expect(useWorkspaceManagementStore.getState().drafts["/one"]!.config.name).toBe("Team");
  });
});
