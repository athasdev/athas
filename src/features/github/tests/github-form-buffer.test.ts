import { describe, expect, it } from "vitest";
import { createPaneContent } from "@/features/editor/stores/buffer-content-factory";
import { getRepositoryDisplayName } from "../utils/github-viewer-utils";

describe("GitHub form buffers", () => {
  it("uses only the repository name in form chrome", () => {
    expect(getRepositoryDisplayName("/Users/mehmetozgul/Documents/Git/athasdev/athas")).toBe(
      "athas",
    );
  });

  it("creates a normal tab-backed pull request form", () => {
    const buffer = createPaneContent("github-form", {
      type: "githubForm",
      repoPath: "/workspace/athas",
      formKind: "pull-request",
      operation: "create",
      defaultHead: "feature/forms",
    });

    expect(buffer).toMatchObject({
      type: "githubForm",
      name: "New Pull Request",
      isPreview: false,
      repoPath: "/workspace/athas",
      defaultHead: "feature/forms",
    });
    expect(buffer.path).toContain("github-form://create/pull-request/");
  });

  it("gives each creation form a distinct tab identity", () => {
    const issue = createPaneContent("issue", {
      type: "githubForm",
      repoPath: "/workspace/athas",
      formKind: "issue",
      operation: "create",
    });
    const workflow = createPaneContent("workflow", {
      type: "githubForm",
      repoPath: "/workspace/athas",
      formKind: "action",
      operation: "create",
    });

    expect(issue.name).toBe("New Issue");
    expect(workflow.name).toBe("Run Workflow");
    expect(issue.path).not.toBe(workflow.path);
  });
});
