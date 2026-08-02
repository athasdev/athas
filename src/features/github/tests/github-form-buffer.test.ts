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
    expect(buffer.path).toContain("github-form://create/pull-request/new/");
  });

  it("gives edit and action forms distinct tab identities", () => {
    const edit = createPaneContent("edit", {
      type: "githubForm",
      repoPath: "/workspace/athas",
      formKind: "issue",
      operation: "edit",
      resourceNumber: 42,
    });
    const review = createPaneContent("review", {
      type: "githubForm",
      repoPath: "/workspace/athas",
      formKind: "pull-request",
      operation: "action",
      resourceNumber: 17,
      actionKind: "request-changes",
    });

    expect(edit.name).toBe("Edit Issue #42");
    expect(review.name).toBe("Request Changes #17");
    expect(edit.path).not.toBe(review.path);
  });
});
