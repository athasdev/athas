import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { GitBlameLine } from "../types/git.types";
import { getInlineGitBlamePresentation } from "../utils/git-blame-decoration";

function createBlameLine(overrides: Partial<GitBlameLine> = {}): GitBlameLine {
  return {
    line_number: 1,
    total_lines: 1,
    commit_hash: "abcdef1234567890",
    is_uncommitted: false,
    author: "Athas Developer",
    email: "developer@athas.dev",
    time: 1_700_000_000,
    commit: "Restore inline blame hover\n\nInclude commit details.",
    ...overrides,
  };
}

describe("inline Git blame presentation", () => {
  afterEach(() => vi.useRealTimers());

  it("does not render blame for uncommitted lines", () => {
    expect(getInlineGitBlamePresentation(createBlameLine({ is_uncommitted: true }))).toBeNull();
  });

  it("shows commit details in the inline text and hover card", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-11-15T22:13:20Z"));

    expect(getInlineGitBlamePresentation(createBlameLine())).toEqual({
      text: "  Athas Developer, yesterday",
      author: "Athas Developer",
      email: "developer@athas.dev",
      relativeTime: "yesterday",
      commitSummary: "Restore inline blame hover",
      commitHash: "abcdef1234567890",
      shortHash: "abcdef1",
    });
  });

  it("preserves commit metadata for the design-system hover card", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-11-15T22:13:20Z"));

    const presentation = getInlineGitBlamePresentation(
      createBlameLine({
        author: "[Athas]",
        email: "",
        commit: "Fix *hover* [card]",
      }),
    );

    expect(presentation).toMatchObject({
      author: "[Athas]",
      email: null,
      relativeTime: "yesterday",
      commitSummary: "Fix *hover* [card]",
    });
  });
});
