import "../styles/github-markdown.css";
import { memo, startTransition, useCallback, useEffect, useMemo, useState } from "react";
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

function getRenderedMarkdownSnapshot(content: string): string | null {
  const cached = markdownRenderCache.get(content);
  if (!cached) return null;

  markdownRenderCache.delete(content);
  markdownRenderCache.set(content, cached);
  return cached;
}

function getCachedRenderedMarkdown(content: string): string {
  const cached = getRenderedMarkdownSnapshot(content);
  if (cached) return cached;

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
    const [renderedHtml, setRenderedHtml] = useState<string | null>(() =>
      getRenderedMarkdownSnapshot(normalizedContent),
    );

    useEffect(() => {
      const cached = getRenderedMarkdownSnapshot(normalizedContent);
      if (cached) {
        setRenderedHtml(cached);
        return;
      }

      setRenderedHtml(null);

      let cancelled = false;
      const idleApi = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      const schedule = idleApi.requestIdleCallback;

      const render = () => {
        const nextHtml = getCachedRenderedMarkdown(normalizedContent);
        if (!cancelled) {
          setRenderedHtml(nextHtml);
        }
      };

      if (typeof schedule === "function") {
        const idleId = schedule(render, { timeout: 200 });
        return () => {
          cancelled = true;
          idleApi.cancelIdleCallback?.(idleId);
        };
      }

      const timeoutId = window.setTimeout(render, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
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
          startTransition(() => {
            openPRBuffer(entityLink.number);
          });
          return;
        }

        if (entityLink.kind === "issue") {
          startTransition(() => {
            openGitHubIssueBuffer({
              issueNumber: entityLink.number,
              repoPath,
              title: `Issue #${entityLink.number}`,
              url: entityLink.url,
            });
          });
          return;
        }

        startTransition(() => {
          openGitHubActionBuffer({
            runId: entityLink.runId,
            repoPath,
            title: `Run #${entityLink.runId}`,
            url: entityLink.url,
          });
        });
      },
      [openGitHubActionBuffer, openGitHubIssueBuffer, openPRBuffer, repoPath],
    );

    return (
      <div
        className={`markdown-preview github-markdown ${className ?? ""}`.trim()}
        onClick={handleClick}
      >
        <div className={`markdown-content ${contentClassName ?? ""}`.trim()}>
          {renderedHtml !== null ? (
            <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
          ) : (
            <div className="whitespace-pre-wrap break-words">{normalizedContent}</div>
          )}
        </div>
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
