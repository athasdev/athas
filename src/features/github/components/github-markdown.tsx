import "../styles/github-markdown.css";
import { memo, useCallback, useMemo } from "react";
import { parseMarkdown } from "@/features/editor/markdown/parser";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { parseGitHubEntityLink } from "../utils/github-link-utils";

interface GitHubMarkdownProps {
  content: string;
  className?: string;
  contentClassName?: string;
  issueBaseUrl?: string;
  repoPath?: string;
}

const MARKDOWN_RENDER_CACHE_LIMIT = 100;
const markdownRenderCache = new Map<string, string>();

function getCachedRenderedMarkdown(content: string): string {
  const cached = markdownRenderCache.get(content);
  if (cached) {
    markdownRenderCache.delete(content);
    markdownRenderCache.set(content, cached);
    return cached;
  }

  const rendered = stripRedundantBreaks(parseMarkdown(content));
  markdownRenderCache.set(content, rendered);

  if (markdownRenderCache.size > MARKDOWN_RENDER_CACHE_LIMIT) {
    const oldestKey = markdownRenderCache.keys().next().value;
    if (oldestKey) {
      markdownRenderCache.delete(oldestKey);
    }
  }

  return rendered;
}

function stripRedundantBreaks(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "")
    .replace(/(?:\s*\n\s*){2,}/g, "\n")
    .trim();
}

// GitHub-flavored markdown renderer for PR descriptions and comments
const GitHubMarkdown = memo(
  ({ content, className, contentClassName, issueBaseUrl, repoPath }: GitHubMarkdownProps) => {
    const { openPRBuffer, openGitHubIssueBuffer, openGitHubActionBuffer } =
      useBufferStore.use.actions();
    const normalizedContent = useMemo(
      () => normalizeGitHubMarkdown(content, issueBaseUrl),
      [content, issueBaseUrl],
    );
    const renderedHtml = useMemo(() => {
      return getCachedRenderedMarkdown(normalizedContent);
    }, [normalizedContent]);

    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const anchor = target.closest("a");
        if (!(anchor instanceof HTMLAnchorElement) || !anchor.href) return;

        const entityLink = parseGitHubEntityLink(anchor.href);
        if (!entityLink || !repoPath) return;

        event.preventDefault();

        if (entityLink.kind === "pullRequest") {
          openPRBuffer(entityLink.number);
          return;
        }

        if (entityLink.kind === "issue") {
          openGitHubIssueBuffer({
            issueNumber: entityLink.number,
            repoPath,
            title: `Issue #${entityLink.number}`,
            url: entityLink.url,
          });
          return;
        }

        openGitHubActionBuffer({
          runId: entityLink.runId,
          repoPath,
          title: `Run #${entityLink.runId}`,
          url: entityLink.url,
        });
      },
      [openGitHubActionBuffer, openGitHubIssueBuffer, openPRBuffer, repoPath],
    );

    return (
      <div
        className={`markdown-preview github-markdown ${className ?? ""}`.trim()}
        onClick={handleClick}
      >
        <div
          className={`markdown-content ${contentClassName ?? ""}`.trim()}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>
    );
  },
);

GitHubMarkdown.displayName = "GitHubMarkdown";

function normalizeGitHubMarkdown(content: string, issueBaseUrl?: string): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine.match(/^https:\/\/github\.com\/user-attachments\/assets\//)) {
        return `[View attachment](${trimmedLine})`;
      }
      if (issueBaseUrl) {
        return line.replace(/(^|[^\w/`])#(\d+)\b/g, (match, prefix, issueNumber) => {
          return `${prefix}[#${issueNumber}](${issueBaseUrl}/issues/${issueNumber})`;
        });
      }
      return line;
    })
    .join("\n");
}

export default GitHubMarkdown;
