import { describe, expect, it } from "vite-plus/test";
import {
  buildDiffSectionIndex,
  extractFilePatch,
  getPullRequestStatus,
  normalizeCommit,
  resolveSafeRepoFilePath,
  toFileDiffFromMetadata,
} from "../services/github-pr-viewer-utils";

const diffText = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 111..222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  "diff --git a/docs/new.md b/docs/new.md",
  "new file mode 100644",
  "@@ -0,0 +1 @@",
  "+hello",
  "diff --git a/legacy.txt b/legacy.txt",
  "deleted file mode 100644",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/old/name.ts b/new/name.ts",
  "similarity index 90%",
  "@@ -3 +3 @@",
  " same",
].join("\n");

describe("toFileDiffFromMetadata", () => {
  it("infers file status from addition and deletion counts", () => {
    expect(toFileDiffFromMetadata({ path: " a.ts ", additions: 4, deletions: 0 })).toEqual({
      path: "a.ts",
      additions: 4,
      deletions: 0,
      status: "added",
    });
    expect(toFileDiffFromMetadata({ path: "b.ts", additions: 0, deletions: 2 }).status).toBe(
      "deleted",
    );
    expect(toFileDiffFromMetadata({ path: "c.ts", additions: 1, deletions: 1 }).status).toBe(
      "modified",
    );
  });

  it("tolerates malformed metadata from the API", () => {
    const diff = toFileDiffFromMetadata({
      path: undefined as unknown as string,
      additions: Number.NaN,
      deletions: Number.POSITIVE_INFINITY,
    });

    expect(diff).toEqual({ path: "", additions: 0, deletions: 0, status: "modified" });
  });
});

describe("diff sections", () => {
  it("returns no sections for empty or header-less diffs", () => {
    expect(buildDiffSectionIndex("")).toEqual({});
    expect(buildDiffSectionIndex("just some text")).toEqual({});
  });

  it("indexes each file by its new path and its old path when renamed", () => {
    const index = buildDiffSectionIndex(diffText);

    expect(Object.keys(index).sort()).toEqual([
      "docs/new.md",
      "legacy.txt",
      "new/name.ts",
      "old/name.ts",
      "src/app.ts",
    ]);
    expect(index["old/name.ts"]).toBe(index["new/name.ts"]);
    expect(index["new/name.ts"].end).toBe(diffText.length);
    expect(diffText.slice(index["src/app.ts"].start, index["src/app.ts"].end)).not.toContain(
      "docs/new.md",
    );
  });

  it("extracts hunk lines and status for each kind of change", () => {
    const index = buildDiffSectionIndex(diffText);

    const modified = extractFilePatch(diffText, "src/app.ts", index);
    expect(modified).toMatchObject({ path: "src/app.ts", oldPath: undefined, status: "modified" });
    expect(modified?.lines.slice(0, 3)).toEqual(["@@ -1,2 +1,2 @@", "-old", "+new"]);
    expect(modified?.lines).not.toContain("index 111..222 100644");
    expect(extractFilePatch(diffText, "docs/new.md", index)?.status).toBe("added");
    const deleted = extractFilePatch(diffText, "legacy.txt", index);
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.lines.slice(0, 2)).toEqual(["@@ -1 +0,0 @@", "-bye"]);
    expect(extractFilePatch(diffText, "old/name.ts", index)).toEqual({
      path: "new/name.ts",
      oldPath: "old/name.ts",
      status: "renamed",
      lines: ["@@ -3 +3 @@", " same"],
    });
  });

  it("returns null when the patch cannot be located", () => {
    const index = buildDiffSectionIndex(diffText);

    expect(extractFilePatch("", "src/app.ts", index)).toBeNull();
    expect(extractFilePatch(diffText, "", index)).toBeNull();
    expect(extractFilePatch(diffText, "missing.ts", index)).toBeNull();
  });
});

describe("resolveSafeRepoFilePath", () => {
  it("joins relative paths under the repository root", () => {
    expect(resolveSafeRepoFilePath("/repo/", "src/app.ts")).toBe("/repo/src/app.ts");
    expect(resolveSafeRepoFilePath("/repo", "/src//app.ts")).toBe("/repo/src/app.ts");
    expect(resolveSafeRepoFilePath("C:\\repo", "src\\app.ts")).toBe("C:\\repo\\src\\app.ts");
  });

  it("rejects paths that could escape the repository", () => {
    expect(resolveSafeRepoFilePath("/repo", "../etc/passwd")).toBeNull();
    expect(resolveSafeRepoFilePath("/repo", "src/./app.ts")).toBeNull();
    expect(resolveSafeRepoFilePath("/repo", "C:/Windows/system.ini")).toBeNull();
    expect(resolveSafeRepoFilePath("/repo", "\\\\server\\share")).toBe("/repo/server/share");
    expect(resolveSafeRepoFilePath("/repo", "src/a\0b")).toBeNull();
  });

  it("rejects empty bases and inputs", () => {
    expect(resolveSafeRepoFilePath("", "a.ts")).toBeNull();
    expect(resolveSafeRepoFilePath("/repo", "")).toBeNull();
    expect(resolveSafeRepoFilePath("/repo", "///")).toBeNull();
  });
});

describe("normalizeCommit", () => {
  it("rejects non-object entries", () => {
    expect(normalizeCommit(null, 0)).toBeNull();
    expect(normalizeCommit("abc", 0)).toBeNull();
  });

  it("normalizes GraphQL-style commits with author nodes", () => {
    const commit = normalizeCommit(
      {
        oid: "abcdef1234",
        messageHeadline: "Fix bug",
        messageBody: "Details",
        authoredDate: "2026-01-01T00:00:00Z",
        url: "https://github.com/o/r/commit/abcdef1234",
        authors: {
          nodes: [{ login: "octo", name: "Octo Cat", email: "o@example.com" }, null],
        },
      },
      0,
    );

    expect(commit).toEqual({
      oid: "abcdef1234",
      messageHeadline: "Fix bug",
      messageBody: "Details",
      authoredDate: "2026-01-01T00:00:00Z",
      url: "https://github.com/o/r/commit/abcdef1234",
      authors: [{ login: "octo", name: "Octo Cat", email: "o@example.com" }],
    });
  });

  it("derives headline and body from a REST-style message", () => {
    const commit = normalizeCommit(
      {
        sha: "123456789",
        message: "Subject line\n\nBody text",
        committedDate: "2026-02-02T00:00:00Z",
        author: { login: "", name: "Dev" },
      },
      3,
    );

    expect(commit).toMatchObject({
      oid: "123456789",
      messageHeadline: "Subject line",
      messageBody: "Body text",
      authoredDate: "2026-02-02T00:00:00Z",
      url: undefined,
      authors: [{ login: "", name: "Dev", email: "" }],
    });
  });

  it("accepts an array of authors and falls back to the short id as headline", () => {
    const commit = normalizeCommit(
      { id: "fedcba987654", authors: [{ login: "a" }, "bad"], createdAt: "2026-03-03" },
      1,
    );

    expect(commit?.messageHeadline).toBe("fedcba9");
    expect(commit?.messageBody).toBe("");
    expect(commit?.authors).toEqual([{ login: "a", name: "", email: "" }]);
  });

  it("generates a stable id from the index when none is present", () => {
    const commit = normalizeCommit({ title: "Title only" }, 4);

    expect(commit?.oid).toBe("commit-5");
    expect(commit?.messageHeadline).toBe("Title only");
    expect(commit?.authors).toEqual([]);
    expect(Number.isNaN(Date.parse(commit?.authoredDate ?? ""))).toBe(false);
  });
});

describe("getPullRequestStatus", () => {
  it("prioritizes merged over closed and draft states", () => {
    expect(getPullRequestStatus({ state: "CLOSED", isDraft: true, mergedAt: "2026-01-01" })).toBe(
      "merged",
    );
    expect(getPullRequestStatus({ state: "CLOSED", isDraft: false, mergedAt: null })).toBe(
      "closed",
    );
    expect(getPullRequestStatus({ state: "OPEN", isDraft: true, mergedAt: null })).toBe("draft");
    expect(getPullRequestStatus({ state: "open", isDraft: false, mergedAt: null })).toBe("open");
  });
});
