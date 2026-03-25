import "../styles/github-markdown.css";
import { memo, useMemo } from "react";
import { parseMarkdown } from "@/features/editor/markdown/parser";

interface GitHubMarkdownProps {
  content: string;
  className?: string;
  contentClassName?: string;
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

  const rendered = parseMarkdown(content);
  markdownRenderCache.set(content, rendered);

  if (markdownRenderCache.size > MARKDOWN_RENDER_CACHE_LIMIT) {
    const oldestKey = markdownRenderCache.keys().next().value;
    if (oldestKey) {
      markdownRenderCache.delete(oldestKey);
    }
  }

  return rendered;
}

// GitHub-flavored markdown renderer for PR descriptions and comments
const GitHubMarkdown = memo(({ content, className, contentClassName }: GitHubMarkdownProps) => {
  const normalizedContent = useMemo(() => normalizeGitHubMarkdown(content), [content]);
  const renderedHtml = useMemo(() => {
    return getCachedRenderedMarkdown(normalizedContent);
  }, [normalizedContent]);

  return (
    <div className={`markdown-preview github-markdown ${className ?? ""}`.trim()}>
      <div
        className={`markdown-content ${contentClassName ?? ""}`.trim()}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    </div>
  );
});

GitHubMarkdown.displayName = "GitHubMarkdown";

function normalizeGitHubMarkdown(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine.match(/^https:\/\/github\.com\/user-attachments\/assets\//)) {
        return `[View attachment](${trimmedLine})`;
      }
      return line;
    })
    .join("\n");
}

export default GitHubMarkdown;
