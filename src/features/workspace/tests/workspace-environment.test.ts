import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const provider = vi.hoisted(() => ({ kind: "local", readDirectory: vi.fn(), readText: vi.fn() }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => provider,
}));
import { inspectWorkspaceEnvironment } from "../team/services/workspace-environment";
beforeEach(() => {
  vi.clearAllMocks();
});
describe("workspace environment inspection", () => {
  it("reads declared versions without executing project code", async () => {
    provider.readDirectory.mockResolvedValue([{ name: "package.json" }, { name: "Cargo.toml" }]);
    provider.readText.mockResolvedValue(
      JSON.stringify({ engines: { node: "24.x" }, packageManager: "bun@1.3.14" }),
    );
    expect(await inspectWorkspaceEnvironment("/repo")).toEqual({
      kind: "local",
      files: ["package.json", "Cargo.toml"],
      requirements: [
        { name: "node", version: "24.x" },
        { name: "Package manager", version: "bun@1.3.14" },
        { name: "Rust", version: "Cargo project" },
      ],
    });
    expect(provider.readText).toHaveBeenCalledWith("/repo/package.json");
  });
  it("does not report an empty project as fully provisioned", async () => {
    provider.readDirectory.mockResolvedValue([]);
    expect((await inspectWorkspaceEnvironment("/empty")).requirements).toEqual([]);
    expect(provider.readText).not.toHaveBeenCalled();
  });
  it("reports inaccessible manifests instead of claiming successful inspection", async () => {
    provider.readDirectory.mockResolvedValue([{ name: "package.json" }]);
    provider.readText.mockRejectedValue(new Error("Permission denied"));
    await expect(inspectWorkspaceEnvironment("/repo")).rejects.toThrow("Permission denied");
  });
});
