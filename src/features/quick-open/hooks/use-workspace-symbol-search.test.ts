import { describe, expect, it } from "vite-plus/test";
import { resolveWorkspaceForFile } from "./use-workspace-symbol-search";

describe("resolveWorkspaceForFile", () => {
  it("matches the exact workspace root", () => {
    expect(resolveWorkspaceForFile("/repo", ["/repo"])).toBe("/repo");
  });

  it("resolves a nested file to its containing workspace root", () => {
    expect(resolveWorkspaceForFile("/repo/src/index.ts", ["/repo"])).toBe("/repo");
  });

  it("picks the longest-prefix match among nested workspace roots", () => {
    const workspaces = ["/repo", "/repo/packages/app"];
    expect(resolveWorkspaceForFile("/repo/packages/app/src/index.ts", workspaces)).toBe(
      "/repo/packages/app",
    );
    expect(resolveWorkspaceForFile("/repo/src/index.ts", workspaces)).toBe("/repo");
  });

  it("returns null when no workspace covers the file", () => {
    expect(resolveWorkspaceForFile("/other/file.ts", ["/repo"])).toBeNull();
  });

  it("handles trailing slashes on workspace roots", () => {
    expect(resolveWorkspaceForFile("/repo/src/index.ts", ["/repo/"])).toBe("/repo");
    expect(resolveWorkspaceForFile("/repo", ["/repo/"])).toBe("/repo");
  });

  it("does not match a sibling directory with a shared prefix", () => {
    expect(resolveWorkspaceForFile("/repo-other/file.ts", ["/repo"])).toBeNull();
  });
});
