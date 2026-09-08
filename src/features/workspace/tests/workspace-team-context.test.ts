import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const io = vi.hoisted(() => ({
  load: vi.fn(),
  bindings: {} as Record<string, Record<string, string>>,
}));
vi.mock("../team/services/team-workspace-service", () => ({ loadTeamWorkspace: io.load }));
vi.mock("../team/stores/workspace-management.store", () => ({
  useWorkspaceManagementStore: { getState: () => ({ bindings: io.bindings }) },
}));
import { loadWorkspaceTeamContext } from "../team/services/workspace-team-context";
const team = {
  version: 1,
  name: "Team",
  instructions: "Use Bun",
  commands: [],
  repositories: [{ id: "web", name: "Web" }],
};
beforeEach(() => {
  io.load.mockReset();
  io.bindings = { "/team": { web: "/checkout" } };
});
describe("linked repository context", () => {
  it("uses a project's own profile before a parent workspace", async () => {
    io.load.mockResolvedValue(team);
    expect(await loadWorkspaceTeamContext("/checkout")).toBe(team);
    expect(io.load).toHaveBeenCalledOnce();
  });
  it("inherits the saved team context through the machine-local checkout mapping", async () => {
    io.load.mockImplementation(async (path: string) => (path === "/team" ? team : null));
    expect(await loadWorkspaceTeamContext("/checkout")).toBe(team);
  });
  it("does not apply rules from a removed repository or an unrelated project", async () => {
    io.load.mockImplementation(async (path: string) =>
      path === "/team" ? { ...team, repositories: [] } : null,
    );
    expect(await loadWorkspaceTeamContext("/checkout")).toBeNull();
    expect(await loadWorkspaceTeamContext("/other")).toBeNull();
  });
  it("reports conflicting memberships instead of picking a team's instructions arbitrarily", async () => {
    io.bindings["/other-team"] = { web: "/checkout" };
    io.load.mockImplementation(async (path: string) => (path === "/checkout" ? null : team));
    await expect(loadWorkspaceTeamContext("/checkout")).rejects.toThrow("multiple team workspaces");
  });
});
