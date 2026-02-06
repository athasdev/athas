import { memo, useMemo } from "react";
import { parseMarkdown } from "@/features/editor/markdown/parser";

interface GitHubMarkdownProps {
  content: string;
  className?: string;
  contentClassName?: string;
}

// GitHub-flavored markdown renderer for PR descriptions and comments
const GitHubMarkdown = memo(({ content, className, contentClassName }: GitHubMarkdownProps) => {
  const renderedHtml = useMemo(() => {
    return parseMarkdown(normalizeGitHubMarkdown(content));
  }, [content]);

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
