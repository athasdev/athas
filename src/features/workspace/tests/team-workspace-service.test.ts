import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({
  readDirectory: vi.fn(),
  readText: vi.fn(),
  writeFile: vi.fn(),
  invoke: vi.fn(),
  dispatchEvent: vi.fn(),
}));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => mocks,
}));
vi.mock("@/features/file-system/controllers/platform", () => ({ writeFile: mocks.writeFile }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { loadTeamWorkspace, saveTeamWorkspace } from "../team/services/team-workspace-service";
const config = { version: 1 as const, name: "Team", instructions: "Use Bun", commands: [] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { dispatchEvent: mocks.dispatchEvent });
  mocks.readDirectory.mockResolvedValue([]);
  mocks.writeFile.mockResolvedValue(undefined);
});
describe("team workspace persistence", () => {
  it("distinguishes an absent profile from a read failure", async () => {
    expect(await loadTeamWorkspace("/repo")).toBeNull();
    mocks.readDirectory.mockRejectedValue(new Error("Permission denied"));
    await expect(loadTeamWorkspace("/repo")).rejects.toThrow("Permission denied");
  });
  it("writes a new profile to its captured workspace", async () => {
    await saveTeamWorkspace("/repo", config, null);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/repo/athas.workspace.json",
      expect.stringContaining('"Use Bun"'),
    );
    expect(mocks.dispatchEvent).toHaveBeenCalledOnce();
  });
  it("refuses to overwrite a profile changed outside the dialog", async () => {
    mocks.readDirectory.mockResolvedValue([{ name: "athas.workspace.json" }]);
    mocks.readText.mockResolvedValue(JSON.stringify({ ...config, name: "Changed" }));
    await expect(saveTeamWorkspace("/repo", config, JSON.stringify(config))).rejects.toThrow(
      "changed on disk",
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
  it("reports malformed profiles without treating them as new", async () => {
    mocks.readDirectory.mockResolvedValue([{ name: "athas.workspace.json" }]);
    mocks.readText.mockResolvedValue("{");
    await expect(loadTeamWorkspace("/repo")).rejects.toThrow("valid JSON");
  });
  it("uses the SSH writer for a remote team workspace", async () => {
    await saveTeamWorkspace("remote://connection/repo", config, null);
    expect(mocks.invoke).toHaveBeenCalledWith("ssh_write_file", {
      connectionId: "connection",
      filePath: "/repo/athas.workspace.json",
      content: expect.any(String),
    });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
