import { formatRelativeTime } from "@/utils/date";
import type { GitBlameLine } from "../types/git.types";

export interface InlineGitBlamePresentation {
  text: string;
  author: string;
  email: string | null;
  relativeTime: string;
  commitSummary: string;
  commitHash: string;
  shortHash: string;
}

export function getInlineGitBlamePresentation(
  blameLine: GitBlameLine,
): InlineGitBlamePresentation | null {
  if (blameLine.is_uncommitted) return null;

  const author = blameLine.author.trim() || "Unknown";
  const relativeTime = formatRelativeTime(blameLine.time);
  const commitSummary = blameLine.commit.trim().split(/\r?\n/, 1)[0] || "No commit message";
  const shortHash = blameLine.commit_hash.slice(0, 7);

  return {
    text: `  ${author}, ${relativeTime}`,
    author,
    email: blameLine.email.trim() || null,
    relativeTime,
    commitSummary,
    commitHash: blameLine.commit_hash,
    shortHash,
  };
}
