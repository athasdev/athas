import { ChatErrorBlock } from "./chat-error-block";
import { parseLegacyErrorBlock } from "@/features/ai/lib/chat-error";
import "./markdown-renderer.css";
import { CheckIcon, CopyIcon } from "@/ui/icons";
import type React from "react";
import { memo, useEffect, useMemo, useState } from "react";
import {
  isExternalMarkdownLink,
  resolveWorkspaceFileLink,
} from "@/features/ai/lib/workspace-file-links";
import {
  normalizeImplicitCodeFences,
  normalizePlainTextFence,
} from "@/features/ai/lib/assistant-markdown";
import { splitMarkdownBlocks } from "@/features/ai/lib/markdown-blocks";
import {
  HighlightedCode,
  useCodeHighlightSegments,
} from "@/features/editor/markdown/highlighted-code";
import { normalizeCodeFenceLanguage } from "@/features/editor/markdown/language-map";
import { openExternalUrl } from "@/utils/external-url";
import { Button } from "@/ui/button";
import { TextLink } from "@/ui/text-link";
import { writeClipboardText } from "@/utils/clipboard";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";

function inferCodeLanguage(code: string): string {
  const trimmed = code.trim();

  if (
    /\b(fn|let|mut|impl|pub|use|match|enum|struct|trait|crate)\b/.test(trimmed) ||
    /anyhow::|Result<|Option<|Some\(|None\b/.test(trimmed)
  ) {
    return "rust";
  }

  if (/^\s*#!/m.test(trimmed) || /\bfi\b|\bthen\b|\bdone\b|\$\w+/.test(trimmed)) {
    return "bash";
  }

  if (/\b(def|import|from|class)\b/.test(trimmed) && /:\s*$/m.test(trimmed)) {
    return "python";
  }

  if (/\b(const|let|function|=>|interface|type)\b/.test(trimmed)) {
    return "typescript";
  }

  return "clike";
}

async function copyTextToClipboard(text: string) {
  await writeClipboardText(text);
}

async function openMarkdownLink(href: string, label: string) {
  if (isExternalMarkdownLink(href)) {
    await openExternalUrl(href);
    return;
  }

  const fileSystem = useFileSystemStore.getState();
  const files = await fileSystem.getAllProjectFiles();
  const target = resolveWorkspaceFileLink(
    href,
    label,
    files,
    useProjectStore.getState().rootFolderPath,
  );

  if (target) {
    await fileSystem.handleFileSelect(
      target.path,
      false,
      target.line,
      target.column,
      undefined,
      false,
    );
    return;
  }

  await openExternalUrl(href);
}

function CodeBlock({ code, languageHint }: { code: string; languageHint: string }) {
  const explicitLanguage = languageHint ? normalizeCodeFenceLanguage(languageHint) : "";
  const inferredLanguage = explicitLanguage || inferCodeLanguage(code);
  const languageLabel = explicitLanguage || (inferredLanguage !== "clike" ? inferredLanguage : "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  const segments = useCodeHighlightSegments(code, inferredLanguage);

  return (
    <figure
      data-ai-element="code-block"
      className="not-typeset group/code my-2 flex min-w-0 flex-col overflow-hidden rounded-lg bg-surface"
    >
      <figcaption className="flex min-h-7 items-center justify-between gap-2 pr-1 pl-3 text-subtle-foreground ui-text-sm">
        <span className="min-w-0 truncate font-mono">{languageLabel}</span>
        {code.trim() ? (
          <span className="opacity-0 transition-opacity duration-fast group-hover/code:opacity-100 focus-within:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                void copyTextToClipboard(code).then(() => setCopied(true));
              }}
              aria-label={copied ? "Copied" : "Copy code"}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </span>
        ) : null}
      </figcaption>
      <pre className="max-w-full overflow-x-auto px-3 pb-2.5 font-mono">
        <code className="block w-max min-w-full whitespace-pre text-foreground ui-text-sm">
          <HighlightedCode code={code} segments={segments} />
        </code>
      </pre>
    </figure>
  );
}

// Header classes scaled for sidebar context
function renderHeader(level: number, text: string, key: string): React.ReactNode {
  const Heading = `h${Math.min(Math.max(level, 1), 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return <Heading key={key}>{renderInlineFormatting(text)}</Heading>;
}

type TableAlignment = "left" | "center" | "right";

type MarkdownTable = {
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
};

function splitMarkdownTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);

  const cells: string[] = [];
  let current = "";

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const next = value[i + 1];

    if (char === "\\" && next === "|") {
      current += "|";
      i += 1;
      continue;
    }

    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseTableSeparatorCell(cell: string): TableAlignment | null {
  const normalized = cell.replace(/\s+/g, "");
  if (!/^:?-{3,}:?$/.test(normalized)) return null;

  const startsWithColon = normalized.startsWith(":");
  const endsWithColon = normalized.endsWith(":");
  if (startsWithColon && endsWithColon) return "center";
  if (endsWithColon) return "right";
  return "left";
}

function normalizeTableRow(cells: string[], columnCount: number): string[] {
  if (cells.length === columnCount) return cells;
  if (cells.length > columnCount) return cells.slice(0, columnCount);
  return [...cells, ...Array.from({ length: columnCount - cells.length }, () => "")];
}

function parseMarkdownTable(
  lines: string[],
  startIndex: number,
): { table: MarkdownTable; endIndex: number } | null {
  const headerLine = lines[startIndex] ?? "";
  const separatorLine = lines[startIndex + 1] ?? "";

  if (!headerLine?.includes("|") || !separatorLine?.includes("|")) return null;

  const headers = splitMarkdownTableRow(headerLine);
  const separatorCells = splitMarkdownTableRow(separatorLine);
  if (headers.length < 2 || separatorCells.length !== headers.length) return null;

  const alignments = separatorCells.map(parseTableSeparatorCell);
  if (alignments.some((alignment) => alignment === null)) return null;

  const rows: string[][] = [];
  let endIndex = startIndex + 2;

  while (endIndex < lines.length) {
    const rowLine = lines[endIndex] ?? "";
    const trimmedLine = rowLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("```") || !rowLine.includes("|")) break;

    rows.push(normalizeTableRow(splitMarkdownTableRow(rowLine), headers.length));
    endIndex += 1;
  }

  return {
    table: {
      headers,
      alignments: alignments as TableAlignment[],
      rows,
    },
    endIndex,
  };
}

function renderTable(table: MarkdownTable, key: string): React.ReactNode {
  return (
    <div key={key} className="typeset-scroll">
      <table>
        <thead>
          <tr>
            {table.headers.map((header, index) => (
              <th key={index} align={table.alignments[index]}>
                {renderInlineFormatting(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} align={table.alignments[cellIndex]}>
                  {renderInlineFormatting(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Cursor-based inline formatting parser
function renderInlineFormatting(text: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  const getInlineKey = (kind: string, value: string) => {
    const offset = text.length - remaining.length;
    return `${kind}-${offset}-${value.length}`;
  };

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push(<code key={getInlineKey("code", codeMatch[0])}>{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const pendingCodeMatch = remaining.match(/^`([^`]*)$/);
    if (pendingCodeMatch) {
      elements.push(
        <code key={getInlineKey("pending-code", pendingCodeMatch[0])}>{pendingCodeMatch[1]}</code>,
      );
      break;
    }

    // Strikethrough
    const strikeMatch = remaining.match(/^~~([^~]+)~~/);
    if (strikeMatch) {
      elements.push(<del key={getInlineKey("strike", strikeMatch[0])}>{strikeMatch[1]}</del>);
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      elements.push(<strong key={getInlineKey("bold", boldMatch[0])}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      elements.push(<em key={getInlineKey("italic", italicMatch[0])}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Links [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const url = linkMatch[2];
      const label = linkMatch[1];
      elements.push(
        <TextLink
          key={getInlineKey("link", linkMatch[0])}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            void openMarkdownLink(url, label);
          }}
        >
          {label}
        </TextLink>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain URL
    const urlMatch = remaining.match(/^(https?:\/\/[^\s<)]+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      elements.push(
        <TextLink
          key={getInlineKey("url", urlMatch[0])}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            void openExternalUrl(url);
          }}
        >
          {url.length > 60 ? `${url.slice(0, 60)}...` : url}
        </TextLink>,
      );
      remaining = remaining.slice(urlMatch[0].length);
      continue;
    }

    // Find next special character or consume all remaining text
    const nextSpecial = remaining.search(/[`~*[\]]|https?:\/\//);
    if (nextSpecial === -1) {
      elements.push(<span key={getInlineKey("text", remaining)}>{remaining}</span>);
      break;
    }
    if (nextSpecial === 0) {
      // Special char at start didn't match any pattern — treat as plain text
      elements.push(<span key={getInlineKey("char", remaining[0])}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    } else {
      const textChunk = remaining.slice(0, nextSpecial);
      elements.push(<span key={getInlineKey("text", textChunk)}>{textChunk}</span>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return elements;
}

// Line-by-line state machine markdown renderer
function renderContent(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let codeBlockContent: string[] = [];
  let codeBlockStartLine = 0;
  let currentList: { type: "ol" | "ul"; items: string[] } | null = null;
  let currentListStartLine = 0;
  let currentParagraph: string[] = [];
  let currentParagraphStartLine = 0;

  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      const code = codeBlockContent.join("\n");
      elements.push(
        <CodeBlock
          key={`code-${codeBlockStartLine}`}
          code={code}
          languageHint={codeBlockLanguage}
        />,
      );
      codeBlockContent = [];
      codeBlockLanguage = "";
    }
  };

  const flushList = () => {
    if (currentList && currentList.items.length > 0) {
      if (currentList.type === "ol") {
        elements.push(
          <ol key={`ol-${currentListStartLine}`}>
            {currentList.items.map((item, idx) => (
              <li key={idx}>{renderInlineFormatting(item)}</li>
            ))}
          </ol>,
        );
      } else {
        elements.push(
          <ul key={`ul-${currentListStartLine}`}>
            {currentList.items.map((item, idx) => (
              <li key={idx}>{renderInlineFormatting(item)}</li>
            ))}
          </ul>,
        );
      }
      currentList = null;
    }
  };

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const paragraphText = currentParagraph.join(" ").trim();
      if (paragraphText) {
        elements.push(
          <p key={`p-${currentParagraphStartLine}`}>{renderInlineFormatting(paragraphText)}</p>,
        );
      }
      currentParagraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Code block fence
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushList();
        flushParagraph();
        inCodeBlock = true;
        codeBlockStartLine = i;
        codeBlockLanguage = line.trimStart().slice(3).trim();
      }
      continue;
    }

    // Inside code block — accumulate
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    const trimmedLine = line.trim();

    const parsedTable = parseMarkdownTable(lines, i);
    if (parsedTable) {
      flushList();
      flushParagraph();
      elements.push(renderTable(parsedTable.table, `table-${i}`));
      i = parsedTable.endIndex - 1;
      continue;
    }

    // Header
    const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushList();
      flushParagraph();
      const level = headerMatch[1].length;
      elements.push(renderHeader(level, headerMatch[2], `h${level}-${i}`));
      continue;
    }

    // Horizontal rule
    if (trimmedLine.match(/^[-*_]{3,}$/) && trimmedLine.length >= 3) {
      flushList();
      flushParagraph();
      elements.push(<hr key={`hr-${i}`} />);
      continue;
    }

    // Blockquote
    if (trimmedLine.startsWith("> ") || trimmedLine === ">") {
      flushList();
      flushParagraph();
      const quoteContent = trimmedLine.startsWith("> ") ? trimmedLine.slice(2) : "";
      elements.push(
        <blockquote key={`quote-${i}`}>{renderInlineFormatting(quoteContent)}</blockquote>,
      );
      continue;
    }

    // Ordered list
    const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      flushParagraph();
      if (currentList?.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
        currentListStartLine = i;
      }
      currentList.items.push(numberedMatch[2]);
      continue;
    }

    // Unordered list
    const bulletMatch = trimmedLine.match(/^[-*+]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      if (currentList?.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
        currentListStartLine = i;
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

    // Regular text — accumulate into paragraph
    flushList();
    if (currentParagraph.length === 0) {
      currentParagraphStartLine = i;
    }
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

/** One blank-line-separated block; unchanged blocks skip re-rendering while a reply streams. */
const MarkdownBlockContent = memo(function MarkdownBlockContent({ text }: { text: string }) {
  return renderContent(text);
});

function MarkdownBlocks({ text }: { text: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(normalizeImplicitCodeFences(text)), [text]);
  return blocks.map((block) => (
    <MarkdownBlockContent key={`block-${block.startLine}`} text={block.text} />
  ));
}

interface MarkdownRendererProps {
  content: string;
  chatId?: string | null;
  onRetry?: () => void | Promise<void>;
  /** Shows a caret after the last block while the reply is still arriving. */
  isStreaming?: boolean;
}

// Simple markdown renderer for AI responses
export default function MarkdownRenderer({
  content,
  chatId,
  onRetry,
  isStreaming = false,
}: MarkdownRendererProps) {
  const normalizedContent = normalizePlainTextFence(content);

  // Check for error blocks first
  if (normalizedContent.includes("[ERROR_BLOCK]")) {
    const errorMatch = normalizedContent.match(/\[ERROR_BLOCK\]([\s\S]*?)\[\/ERROR_BLOCK\]/);
    if (errorMatch) {
      const errorStart = errorMatch.index ?? 0;
      return (
        <div className="typeset typeset-chat">
          <MarkdownBlocks text={normalizedContent.slice(0, errorStart)} />
          <ChatErrorBlock
            error={parseLegacyErrorBlock(errorMatch[1])}
            chatId={chatId}
            onRetry={onRetry}
          />
          <MarkdownBlocks text={normalizedContent.slice(errorStart + errorMatch[0].length)} />
        </div>
      );
    }
  }

  return (
    <div className="typeset typeset-chat" data-streaming={isStreaming || undefined}>
      <MarkdownBlocks text={normalizedContent} />
    </div>
  );
}
