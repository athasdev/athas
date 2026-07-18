import { describe, expect, it } from "vite-plus/test";
import { normalizeAcpWorkspacePath } from "@/features/ai/lib/acp-workspace-path";

describe("ACP workspace path", () => {
  it("normalizes missing workspace path to null", () => {
    expect(normalizeAcpWorkspacePath(null)).toBeNull();
    expect(normalizeAcpWorkspacePath("   ")).toBeNull();
  });

  it("normalizes Windows paths for status comparisons", () => {
    expect(normalizeAcpWorkspacePath("C:\\Users\\Me\\Project\\")).toBe("c:/users/me/project");
    expect(normalizeAcpWorkspacePath("c:/users/me/project")).toBe("c:/users/me/project");
    expect(normalizeAcpWorkspacePath("C:\\")).toBe("c:/");
  });

  it("keeps POSIX path casing intact", () => {
    expect(normalizeAcpWorkspacePath("/Users/Me/Project/")).toBe("/Users/Me/Project");
  });
});
