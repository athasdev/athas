import { ExternalLink } from "lucide-react";
import { memo, useMemo } from "react";

interface GitHubMarkdownProps {
  content: string;
}

// GitHub-flavored markdown renderer for PR descriptions and comments
const GitHubMarkdown = memo(({ content }: GitHubMarkdownProps) => {
  const renderedContent = useMemo(() => {
    return renderMarkdown(content);
  }, [content]);

  return <div className="github-markdown">{renderedContent}</div>;
});

GitHubMarkdown.displayName = "GitHubMarkdown";

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: { type: "ol" | "ul"; items: string[]; start?: number } | null = null;
  let currentParagraph: string[] = [];
  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let codeBlockContent: string[] = [];
  let key = 0;

  const flushList = () => {
    if (currentList && currentList.items.length > 0) {
      if (currentList.type === "ol") {
        elements.push(
          <ol key={key++} className="my-2 ml-6 list-decimal space-y-1" start={currentList.start}>
            {currentList.items.map((item, idx) => (
              <li key={idx} className="text-text-light">
                {renderInline(item)}
              </li>
            ))}
          </ol>,
        );
      } else {
        elements.push(
          <ul key={key++} className="my-2 ml-6 list-disc space-y-1">
            {currentList.items.map((item, idx) => (
              <li key={idx} className="text-text-light">
                {renderInline(item)}
              </li>
            ))}
          </ul>,
        );
      }
      currentList = null;
    }
  };

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(" ").trim();
      if (text) {
        elements.push(
          <p key={key++} className="my-2 text-text-light">
            {renderInline(text)}
          </p>,
        );
      }
      currentParagraph = [];
    }
  };

  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      elements.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded border border-border bg-primary-bg p-3"
        >
          {codeBlockLanguage && (
            <div className="mb-2 text-text-lighter text-xs">{codeBlockLanguage}</div>
          )}
          <code className="block whitespace-pre font-mono text-text text-xs">
            {codeBlockContent.join("\n")}
          </code>
        </pre>,
      );
      codeBlockContent = [];
      codeBlockLanguage = "";
    }
  };

  for (const line of lines) {
    // Handle code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushList();
        flushParagraph();
        inCodeBlock = true;
        codeBlockLanguage = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    const trimmedLine = line.trim();

    // Skip HTML image tags (they're rendered separately)
    if (trimmedLine.startsWith("<img")) {
      flushList();
      flushParagraph();
      elements.push(renderHtmlImage(trimmedLine, key++));
      continue;
    }

    // Skip HTML video tags
    if (trimmedLine.match(/^https:\/\/github\.com\/user-attachments\/assets\//)) {
      flushList();
      flushParagraph();
      elements.push(
        <div key={key++} className="my-3">
          <a
            href={trimmedLine}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent text-sm hover:underline"
          >
            <ExternalLink size={14} />
            View video attachment
          </a>
        </div>,
      );
      continue;
    }

    // Headers
    const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushList();
      flushParagraph();
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      elements.push(renderHeader(level, text, key++));
      continue;
    }

    // Horizontal rule
    if (trimmedLine.match(/^[-*_]{3,}$/)) {
      flushList();
      flushParagraph();
      elements.push(<hr key={key++} className="my-4 border-border" />);
      continue;
    }

    // Numbered list
    const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      flushParagraph();
      const num = parseInt(numberedMatch[1], 10);
      if (currentList?.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [], start: num };
      }
      currentList.items.push(numberedMatch[2]);
      continue;
    }

    // Bullet list
    const bulletMatch = trimmedLine.match(/^[-*+]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      if (currentList?.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(bulletMatch[1]);
      continue;
    }

    // Empty line
    if (trimmedLine === "") {
      flushList();
      flushParagraph();
      continue;
    }

    // Regular text - add to paragraph
    flushList();
    currentParagraph.push(trimmedLine);
  }

  // Flush remaining content
  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushList();
  flushParagraph();

  return elements;
}

function renderHeader(level: number, text: string, key: number): React.ReactNode {
  const classes: Record<number, string> = {
    1: "mt-4 mb-2 border-b border-border pb-2 font-semibold text-text text-lg",
    2: "mt-4 mb-2 border-b border-border pb-1 font-semibold text-text text-base",
    3: "mt-3 mb-1 font-semibold text-text text-sm",
    4: "mt-2 mb-1 font-medium text-text text-sm",
    5: "mt-2 mb-1 font-medium text-text-light text-sm",
    6: "mt-2 mb-1 font-medium text-text-lighter text-sm",
  };

  const content = renderInline(text);

  switch (level) {
    case 1:
      return (
        <h1 key={key} className={classes[1]}>
          {content}
        </h1>
      );
    case 2:
      return (
        <h2 key={key} className={classes[2]}>
          {content}
        </h2>
      );
    case 3:
      return (
        <h3 key={key} className={classes[3]}>
          {content}
        </h3>
      );
    case 4:
      return (
        <h4 key={key} className={classes[4]}>
          {content}
        </h4>
      );
    case 5:
      return (
        <h5 key={key} className={classes[5]}>
          {content}
        </h5>
      );
    default:
      return (
        <h6 key={key} className={classes[6]}>
          {content}
        </h6>
      );
  }
}

function renderHtmlImage(html: string, key: number): React.ReactNode {
  const srcMatch = html.match(/src="([^"]+)"/);
  const altMatch = html.match(/alt="([^"]+)"/);

  if (!srcMatch) return null;

  return (
    <div key={key} className="my-3">
      <img
        src={srcMatch[1]}
        alt={altMatch?.[1] || "Image"}
        className="max-w-full rounded border border-border"
        loading="lazy"
      />
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push(
        <code
          key={key++}
          className="rounded bg-primary-bg px-1.5 py-0.5 font-mono text-text text-xs"
        >
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      elements.push(
        <strong key={key++} className="font-semibold text-text">
          {boldMatch[1]}
        </strong>,
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      elements.push(
        <em key={key++} className="italic">
          {italicMatch[1]}
        </em>,
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Links [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      elements.push(
        <a
          key={key++}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {linkMatch[1]}
        </a>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Issue/PR references (#123)
    const issueMatch = remaining.match(/^#(\d+)/);
    if (issueMatch) {
      elements.push(
        <span key={key++} className="text-accent">
          #{issueMatch[1]}
        </span>,
      );
      remaining = remaining.slice(issueMatch[0].length);
      continue;
    }

    // Plain URL
    const urlMatch = remaining.match(/^(https?:\/\/[^\s<]+)/);
    if (urlMatch) {
      elements.push(
        <a
          key={key++}
          href={urlMatch[1]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {urlMatch[1].length > 50 ? `${urlMatch[1].slice(0, 50)}...` : urlMatch[1]}
        </a>,
      );
      remaining = remaining.slice(urlMatch[0].length);
      continue;
    }

    // Find next special character or take all remaining text
    const nextSpecial = remaining.search(/[`*[#]|https?:\/\//);
    if (nextSpecial === -1) {
      elements.push(<span key={key++}>{remaining}</span>);
      break;
    } else if (nextSpecial === 0) {
      // Special character at start but didn't match any pattern - treat as plain text
      elements.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    } else {
      elements.push(<span key={key++}>{remaining.slice(0, nextSpecial)}</span>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return elements;
}

export default GitHubMarkdown;
