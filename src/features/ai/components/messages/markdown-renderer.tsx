import { invoke } from "@tauri-apps/api/core";
import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  CopyIcon as Copy,
  TerminalWindowIcon as Terminal,
} from "@phosphor-icons/react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { MarkdownRendererProps } from "@/features/ai/types/ai-chat.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Button } from "@/ui/button";
import {
  fetchHighlightQuery,
  getDefaultParserWasmUrl,
} from "@/features/editor/lib/wasm-parser/extension-assets";
import { tokenizeCodeWithTree } from "@/features/editor/lib/wasm-parser/tokenizer";
import { normalizeLanguage } from "@/features/editor/markdown/language-map";

const LANGUAGE_HINTS = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "diff",
  "docker",
  "elixir",
  "erlang",
  "go",
  "graphql",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "nginx",
  "objectivec",
  "perl",
  "php",
  "python",
  "r",
  "ruby",
  "rust",
  "scala",
  "scss",
  "shell",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "vim",
  "xml",
  "yaml",
]);

const CODE_LINE_PATTERN =
  /[{}()[\];]|=>|::|->|:=|==|!=|<=|>=|&&|\|\||^\s{2,}\S|^(let|const|var|fn|def|class|import|export|if|for|while|match|return|use|pub|impl|SELECT|FROM|INSERT|UPDATE|DELETE)\b/i;

function stripQuoteWrappers(line: string): string {
  const trimmed = line.trim();
  return trimmed
    .replace(/^(["'`“”‘’])+/, "")
    .replace(/(["'`“”‘’])+$/, "")
    .replace(/[:;,]$/, "")
    .trim();
}

function extractLanguageHint(line: string): string | null {
  const candidate = stripQuoteWrappers(line);
  if (!/^[A-Za-z][A-Za-z0-9+#._-]{0,19}$/.test(candidate)) return null;

  const normalized = normalizeLanguage(candidate);
  if (!LANGUAGE_HINTS.has(normalized)) return null;
  return normalized;
}

function isLikelyCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>)/.test(trimmed)) return false;
  return CODE_LINE_PATTERN.test(line);
}

function normalizeImplicitCodeFences(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const languageHint = extractLanguageHint(lines[i]);
    const nextLine = lines[i + 1];

    if (!languageHint || nextLine === undefined || !isLikelyCodeLine(nextLine)) {
      output.push(lines[i]);
      continue;
    }

    output.push(`\`\`\`${languageHint}`);
    i += 1;

    while (i < lines.length) {
      const current = lines[i];
      const trimmed = current.trim();
      if (!trimmed || trimmed === '"' || trimmed === "'") {
        break;
      }
      output.push(current);
      i += 1;
    }

    output.push("```");

    if (i < lines.length && lines[i].trim() === "") {
      output.push("");
    }
  }

  return output.join("\n");
}

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

type HighlightSegment = {
  start: number;
  end: number;
  className: string;
};

const TREE_SITTER_QUERY_CACHE = new Map<string, string>();
const TREE_SITTER_TOKEN_CACHE = new Map<string, HighlightSegment[]>();

async function copyTextToClipboard(text: string) {
  try {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

const TREE_SITTER_LANGUAGE_ALIASES: Record<string, string> = {
  csharp: "csharp",
  jsx: "tsx",
  shell: "bash",
  markup: "html",
  xml: "html",
  objectivec: "objc",
};

function resolveTreeSitterLanguage(language: string): string | null {
  const normalized = normalizeLanguage(language);
  if (normalized === "clike") return null;
  return TREE_SITTER_LANGUAGE_ALIASES[normalized] || normalized;
}

function normalizeSegments(tokens: HighlightSegment[], maxLength: number): HighlightSegment[] {
  if (tokens.length === 0) return [];

  const sorted = [...tokens].sort((a, b) => a.start - b.start || a.end - b.end);
  const normalized: HighlightSegment[] = [];
  let cursor = 0;

  for (const token of sorted) {
    const start = Math.max(0, Math.min(maxLength, token.start));
    const end = Math.max(0, Math.min(maxLength, token.end));
    if (end <= start) continue;

    const clampedStart = Math.max(start, cursor);
    if (end <= clampedStart) continue;

    normalized.push({
      ...token,
      start: clampedStart,
      end,
    });

    cursor = end;
  }

  return normalized;
}

function renderHighlightedCode(code: string, segments: HighlightSegment[]): React.ReactNode {
  if (segments.length === 0) {
    return code;
  }

  const elements: React.ReactNode[] = [];
  let lastEnd = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.start > lastEnd) {
      elements.push(<span key={`t-${i}`}>{code.slice(lastEnd, segment.start)}</span>);
    }

    elements.push(
      <span key={`k-${i}`} className={segment.className}>
        {code.slice(segment.start, segment.end)}
      </span>,
    );
    lastEnd = segment.end;
  }

  if (lastEnd < code.length) {
    elements.push(<span key="e">{code.slice(lastEnd)}</span>);
  }

  return <>{elements}</>;
}

function CodeBlock({
  code,
  languageHint,
  onApplyCode,
}: {
  code: string;
  languageHint: string;
  onApplyCode?: (code: string, language?: string) => void;
}) {
  const explicitLanguage = languageHint ? normalizeLanguage(languageHint) : "";
  const inferredLanguage = explicitLanguage || inferCodeLanguage(code);
  const treeSitterLanguage = resolveTreeSitterLanguage(inferredLanguage);
  const languageLabel = explicitLanguage || (inferredLanguage !== "clike" ? inferredLanguage : "");

  const [segments, setSegments] = useState<HighlightSegment[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSegments(null);

    if (!treeSitterLanguage) {
      setSegments([]);
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = `${treeSitterLanguage}:${code}`;
    const cached = TREE_SITTER_TOKEN_CACHE.get(cacheKey);
    if (cached) {
      setSegments(cached);
      return () => {
        cancelled = true;
      };
    }

    const loadHighlighting = async () => {
      try {
        const wasmPath = getDefaultParserWasmUrl(treeSitterLanguage);
        let highlightQuery = TREE_SITTER_QUERY_CACHE.get(treeSitterLanguage);

        if (!highlightQuery) {
          const resolved = await fetchHighlightQuery(treeSitterLanguage, {
            wasmUrl: wasmPath,
            cacheMode: "no-store",
          });
          highlightQuery = resolved.query || "";
          TREE_SITTER_QUERY_CACHE.set(treeSitterLanguage, highlightQuery);
        }

        const result = await tokenizeCodeWithTree(code, treeSitterLanguage, {
          languageId: treeSitterLanguage,
          wasmPath,
          highlightQuery,
        });

        const tokenSegments = normalizeSegments(
          result.tokens.map((token) => ({
            start: token.startIndex,
            end: token.endIndex,
            className: token.type,
          })),
          code.length,
        );

        try {
          result.tree.delete();
        } catch {}

        if (cancelled) return;

        TREE_SITTER_TOKEN_CACHE.set(cacheKey, tokenSegments);
        setSegments(tokenSegments);
      } catch {
        if (!cancelled) {
          setSegments([]);
        }
      }
    };

    loadHighlighting();

    return () => {
      cancelled = true;
    };
  }, [code, treeSitterLanguage]);

  const renderedCode = useMemo(() => renderHighlightedCode(code, segments || []), [code, segments]);

  return (
    <div className="group relative my-2">
      <pre className="editor-font max-w-full overflow-x-auto rounded border border-border bg-secondary-bg p-2">
        <div className="mb-1 flex items-center justify-between">
          {languageLabel && (
            <div className="editor-font text-text-lighter ui-text-xs">{languageLabel}</div>
          )}
          {code.trim() && (
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Button
                type="button"
                variant="ghost"
                className="rounded"
                onClick={() => void copyTextToClipboard(code)}
                tooltip="Copy code"
              >
                <Copy className="text-text-lighter" size={12} />
              </Button>
              {onApplyCode && (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => onApplyCode(code)}
                  className="h-5 px-1.5 ui-text-xs"
                  tooltip="Apply this code to current buffer"
                >
                  Apply
                </Button>
              )}
            </div>
          )}
        </div>
        <code className="editor-font block whitespace-pre-wrap break-all text-text ui-text-xs">
          {renderedCode}
        </code>
      </pre>
    </div>
  );
}

// Error Block Component
function ErrorBlock({ errorData }: { errorData: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRestartingSession, setIsRestartingSession] = useState(false);
  const openTerminalBuffer = useBufferStore((state) => state.actions.openTerminalBuffer);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const setChatAcpSessionId = useAIChatStore((state) => state.setChatAcpSessionId);
  const setAvailableSlashCommands = useAIChatStore((state) => state.setAvailableSlashCommands);
  const setSessionModeState = useAIChatStore((state) => state.setSessionModeState);
  const setSessionConfigOptions = useAIChatStore((state) => state.setSessionConfigOptions);

  const lines = errorData.split("\n");
  const title =
    lines
      .find((l) => l.startsWith("title:"))
      ?.replace("title:", "")
      .trim() || "";
  const code =
    lines
      .find((l) => l.startsWith("code:"))
      ?.replace("code:", "")
      .trim() || "";
  const message =
    lines
      .find((l) => l.startsWith("message:"))
      ?.replace("message:", "")
      .trim() || "";
  const details =
    lines
      .find((l) => l.startsWith("details:"))
      ?.replace("details:", "")
      .trim() || "";
  const summary = title || message || "Error";
  const normalizedDetails = details && details !== message ? details : "";
  const isAuthRequired = code === "AUTH_REQUIRED";

  const suggestedCommand = useMemo(() => {
    const normalizedText = `${summary} ${message} ${normalizedDetails}`.toLowerCase();

    if (normalizedText.includes("claude code")) {
      return "claude auth login";
    }
    if (normalizedText.includes("codex")) {
      return "codex";
    }
    if (normalizedText.includes("gemini")) {
      return "gemini";
    }
    if (normalizedText.includes("opencode")) {
      return "opencode";
    }
    if (normalizedText.includes("qwen")) {
      return "qwen";
    }
    if (normalizedText.includes("kimi")) {
      return "kimi";
    }

    return null;
  }, [summary, message, normalizedDetails]);

  const handleRestartAgentSession = async () => {
    setIsRestartingSession(true);
    try {
      await invoke("stop_acp_agent");
      if (currentChatId) {
        setChatAcpSessionId(currentChatId, null);
      }
      setAvailableSlashCommands([]);
      setSessionModeState(null, []);
      setSessionConfigOptions([]);
    } catch (error) {
      console.error("Failed to restart ACP agent session:", error);
    } finally {
      setIsRestartingSession(false);
    }
  };

  return (
    <div className="my-1 rounded-lg border border-error/25 bg-error/8 px-2.5 py-2">
      <div className="ui-text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-error">Error</span>
        <span className="text-text">{summary}</span>
        {code ? <span className="text-text-lighter">({code})</span> : null}
        {normalizedDetails && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-auto px-1 text-error/70 hover:bg-transparent hover:text-error"
          >
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
            {isExpanded ? "Hide details" : "Details"}
          </Button>
        )}
      </div>
      {isAuthRequired && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="default"
            onClick={() => void handleRestartAgentSession()}
            disabled={isRestartingSession}
            className="h-auto gap-1.5"
          >
            <Terminal size={12} />
            {isRestartingSession ? "Restarting..." : "Restart Agent Session"}
          </Button>
          {suggestedCommand ? (
            <Button
              type="button"
              variant="default"
              onClick={() =>
                openTerminalBuffer({
                  command: suggestedCommand,
                  name: suggestedCommand,
                })
              }
              className="h-auto gap-1.5"
            >
              <Terminal size={12} />
              Open Login Terminal
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              onClick={() => openTerminalBuffer({ name: "Agent authentication" })}
              className="h-auto gap-1.5"
            >
              <Terminal size={12} />
              Open Terminal
            </Button>
          )}
          <span className="ui-text-xs text-error/70">
            Complete login in the agent CLI, then retry.
          </span>
        </div>
      )}
      {normalizedDetails && isExpanded && (
        <pre className="ui-text-xs editor-font mt-2 overflow-x-auto rounded border border-error/20 bg-error/8 p-2 text-error/90">
          {(() => {
            try {
              const parsed = JSON.parse(normalizedDetails);
              return JSON.stringify(parsed, null, 2);
            } catch {
              return normalizedDetails;
            }
          })()}
        </pre>
      )}
    </div>
  );
}

// Header classes scaled for sidebar context
const headerClasses: Record<number, string> = {
  1: "mt-3 mb-1.5 font-semibold ui-text-sm text-text",
  2: "ui-text-sm mt-2.5 mb-1 font-semibold text-text",
  3: "mt-2 mb-1 font-semibold text-text ui-text-xs",
  4: "mt-2 mb-0.5 font-medium text-text ui-text-xs",
  5: "mt-1.5 mb-0.5 font-medium text-text-light ui-text-xs",
  6: "mt-1.5 mb-0.5 font-medium text-text-lighter ui-text-xs",
};

function renderHeader(level: number, text: string, key: number): React.ReactNode {
  const className = headerClasses[level] || headerClasses[6];
  const content = renderInlineFormatting(text);

  switch (level) {
    case 1:
      return (
        <h1 key={key} className={className}>
          {content}
        </h1>
      );
    case 2:
      return (
        <h2 key={key} className={className}>
          {content}
        </h2>
      );
    case 3:
      return (
        <h3 key={key} className={className}>
          {content}
        </h3>
      );
    case 4:
      return (
        <h4 key={key} className={className}>
          {content}
        </h4>
      );
    case 5:
      return (
        <h5 key={key} className={className}>
          {content}
        </h5>
      );
    default:
      return (
        <h6 key={key} className={className}>
          {content}
        </h6>
      );
  }
}

type TableAlignment = "left" | "center" | "right";

type MarkdownTable = {
  headers: string[];
  alignments: TableAlignment[];
  rows: string[][];
};

const INLINE_CODE_CLASS_NAME =
  "editor-font inline whitespace-break-spaces rounded bg-secondary-bg/80 px-1 py-0 text-[0.95em] leading-[inherit] text-text align-baseline";
const INLINE_LINK_CLASS_NAME =
  "inline cursor-pointer break-words font-[inherit] leading-[inherit] text-accent hover:underline";

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

function getTableAlignmentClass(alignment: TableAlignment): string {
  switch (alignment) {
    case "center":
      return "text-center";
    case "right":
      return "text-right";
    default:
      return "text-left";
  }
}

function renderTable(table: MarkdownTable, key: number): React.ReactNode {
  return (
    <div key={key} className="my-2 max-w-full overflow-x-auto">
      <table className="w-full min-w-max border-collapse ui-text-xs">
        <thead>
          <tr className="border-border border-b">
            {table.headers.map((header, index) => (
              <th
                key={index}
                className={`bg-secondary-bg px-2 py-1.5 font-medium text-text ${getTableAlignmentClass(table.alignments[index])}`}
              >
                {renderInlineFormatting(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-border/70 border-b last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-2 py-1.5 text-text-light align-top ${getTableAlignmentClass(table.alignments[cellIndex])}`}
                >
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
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push(
        <code key={key++} className={INLINE_CODE_CLASS_NAME}>
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const pendingCodeMatch = remaining.match(/^`([^`]*)$/);
    if (pendingCodeMatch) {
      elements.push(
        <code key={key++} className={INLINE_CODE_CLASS_NAME}>
          {pendingCodeMatch[1]}
        </code>,
      );
      break;
    }

    // Strikethrough
    const strikeMatch = remaining.match(/^~~([^~]+)~~/);
    if (strikeMatch) {
      elements.push(
        <del key={key++} className="text-text-lighter line-through">
          {strikeMatch[1]}
        </del>,
      );
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      elements.push(
        <strong key={key++} className="font-semibold">
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
      const url = linkMatch[2];
      elements.push(
        <a
          key={key++}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
          }}
          className={INLINE_LINK_CLASS_NAME}
        >
          {linkMatch[1]}
        </a>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain URL
    const urlMatch = remaining.match(/^(https?:\/\/[^\s<)]+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      elements.push(
        <a
          key={key++}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
          }}
          className={INLINE_LINK_CLASS_NAME}
        >
          {url.length > 60 ? `${url.slice(0, 60)}...` : url}
        </a>,
      );
      remaining = remaining.slice(urlMatch[0].length);
      continue;
    }

    // Find next special character or consume all remaining text
    const nextSpecial = remaining.search(/[`~*[\]]|https?:\/\//);
    if (nextSpecial === -1) {
      elements.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (nextSpecial === 0) {
      // Special char at start didn't match any pattern — treat as plain text
      elements.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    } else {
      elements.push(<span key={key++}>{remaining.slice(0, nextSpecial)}</span>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return elements;
}

// Line-by-line state machine markdown renderer
function renderContent(
  text: string,
  onApplyCode?: (code: string, language?: string) => void,
): React.ReactNode[] {
  const lines = normalizeImplicitCodeFences(text).split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let codeBlockContent: string[] = [];
  let currentList: { type: "ol" | "ul"; items: string[] } | null = null;
  let currentParagraph: string[] = [];
  let key = 0;

  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      const code = codeBlockContent.join("\n");
      elements.push(
        <CodeBlock
          key={key++}
          code={code}
          languageHint={codeBlockLanguage}
          onApplyCode={onApplyCode}
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
          <ol key={key++} className="my-2 ml-5 list-decimal space-y-0.5">
            {currentList.items.map((item, idx) => (
              <li key={idx} className="pl-1 text-text">
                {renderInlineFormatting(item)}
              </li>
            ))}
          </ol>,
        );
      } else {
        elements.push(
          <ul key={key++} className="my-2 ml-5 list-disc space-y-0.5">
            {currentList.items.map((item, idx) => (
              <li key={idx} className="pl-1 text-text">
                {renderInlineFormatting(item)}
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
      const paragraphText = currentParagraph.join(" ").trim();
      if (paragraphText) {
        elements.push(
          <p key={key++} className="my-1.5 leading-[1.6]">
            {renderInlineFormatting(paragraphText)}
          </p>,
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
      elements.push(renderTable(parsedTable.table, key++));
      i = parsedTable.endIndex - 1;
      continue;
    }

    // Header
    const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushList();
      flushParagraph();
      const level = headerMatch[1].length;
      elements.push(renderHeader(level, headerMatch[2], key++));
      continue;
    }

    // Horizontal rule
    if (trimmedLine.match(/^[-*_]{3,}$/) && trimmedLine.length >= 3) {
      flushList();
      flushParagraph();
      elements.push(<hr key={key++} className="my-3 border-border" />);
      continue;
    }

    // Blockquote
    if (trimmedLine.startsWith("> ") || trimmedLine === ">") {
      flushList();
      flushParagraph();
      const quoteContent = trimmedLine.startsWith("> ") ? trimmedLine.slice(2) : "";
      elements.push(
        <blockquote
          key={key++}
          className="my-2 border-border border-l-2 pl-3 text-text-light italic"
        >
          {renderInlineFormatting(quoteContent)}
        </blockquote>,
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

// Simple markdown renderer for AI responses
export default function MarkdownRenderer({ content, onApplyCode }: MarkdownRendererProps) {
  // Check for error blocks first
  if (content.includes("[ERROR_BLOCK]")) {
    const errorMatch = content.match(/\[ERROR_BLOCK\]([\s\S]*?)\[\/ERROR_BLOCK\]/);
    if (errorMatch) {
      return <ErrorBlock errorData={errorMatch[1]} />;
    }
  }

  return <div>{renderContent(content, onApplyCode)}</div>;
}
