import { formatRelativeTime } from "@/utils/date";
import type { GitBlameLine } from "../types/git.types";

export interface InlineGitBlamePresentation {
  text: string;
  hoverMarkdown: string;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_[\]{}()<>#+\-.!|])/g, "\\$1");
}

export function getInlineGitBlamePresentation(
  blameLine: GitBlameLine,
): InlineGitBlamePresentation | null {
  if (blameLine.is_uncommitted) return null;

  const author = blameLine.author.trim() || "Unknown";
  const relativeTime = formatRelativeTime(blameLine.time);
  const commitSummary = blameLine.commit.trim().split(/\r?\n/, 1)[0] || "No commit message";
  const shortHash = blameLine.commit_hash.slice(0, 7);
  const authorDetails = blameLine.email.trim() ? `${author} <${blameLine.email.trim()}>` : author;

  return {
    text: `  ${author}, ${relativeTime}`,
    hoverMarkdown: [
      `**${escapeMarkdownText(commitSummary)}**`,
      `${escapeMarkdownText(authorDetails)} · ${escapeMarkdownText(relativeTime)}`,
      `\`${shortHash}\``,
    ].join("\n\n"),
  };
}
