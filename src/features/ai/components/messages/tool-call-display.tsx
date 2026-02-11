import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";

interface ToolCallDisplayProps {
  toolName: string;
  input?: any;
  output?: any;
  isStreaming?: boolean;
  error?: string;
  onOpenInEditor?: (filePath: string) => void;
}

type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

const toolIcons: Record<string, React.ElementType> = {
  read: FileText,
  edit: FileText,
  write: FileText,
  multiedit: FileText,
  delete: FileText,
  grep: Search,
  search: Search,
  glob: FolderOpen,
  list_dir: FolderOpen,
  ls: FolderOpen,
  run_terminal: Terminal,
  bash: Terminal,
  execute: Terminal,
  webfetch: Globe,
  websearch: Globe,
  fetch: Globe,
  default: Wrench,
};

const TOOL_BLOCK_MAX_LINES = 20;

function normalizeToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function pickToolIcon(toolName: string): React.ElementType {
  const normalized = normalizeToolName(toolName);

  for (const [key, icon] of Object.entries(toolIcons)) {
    if (key !== "default" && normalized.includes(key)) {
      return icon;
    }
  }

  return toolIcons.default;
}

function resolveStatus(input: {
  isStreaming?: boolean;
  error?: string;
  output?: unknown;
}): ToolStatus {
  if (input.error) return "failed";
  if (input.isStreaming) return "in_progress";
  if (input.output !== undefined) return "completed";
  return "pending";
}

function statusLabel(status: ToolStatus): string {
  switch (status) {
    case "in_progress":
      return "Running";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    default:
      return "Pending";
  }
}

function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function extractFilePath(input?: any, output?: any): string | undefined {
  const candidates = [
    input?.file_path,
    input?.path,
    input?.target_path,
    input?.notebook_path,
    output?.file_path,
    output?.path,
  ];

  return candidates.find((value) => typeof value === "string" && value.trim().length > 0);
}

function summarizeTool(toolName: string, input?: any, output?: any): string {
  const normalized = normalizeToolName(toolName);
  const filePath = extractFilePath(input, output);
  if (filePath) return filePath;

  if (typeof input?.command === "string") return truncate(input.command, 72);
  if (typeof input?.pattern === "string") return `pattern: ${truncate(input.pattern, 56)}`;
  if (typeof input?.query === "string") return truncate(input.query, 72);
  if (typeof input?.url === "string") return truncate(input.url, 72);

  if (normalized.includes("list_dir") || normalized === "ls") {
    return input?.path || ".";
  }

  return "tool call";
}

function toLines(value: string, maxLines = TOOL_BLOCK_MAX_LINES): string[] {
  const lines = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines), `... (${lines.length - maxLines} more lines)`];
}

function renderJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderDiffLines(
  lines: Array<{ prefix: string; text: string; kind: "add" | "remove" | "neutral" }>,
) {
  return (
    <div className="overflow-hidden rounded border border-border bg-primary-bg">
      <div className="max-h-60 overflow-auto">
        {lines.map((line, index) => (
          <div
            key={`${line.prefix}-${index}`}
            className={cn(
              "flex font-mono text-[11px] leading-5",
              line.kind === "add" && "bg-emerald-500/10 text-emerald-300",
              line.kind === "remove" && "bg-red-500/10 text-red-300",
              line.kind === "neutral" && "text-text-lighter",
            )}
          >
            <span className="w-5 shrink-0 text-center opacity-70">{line.prefix}</span>
            <span className="flex-1 whitespace-pre-wrap pr-2">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildEditPreview(toolName: string, input?: any, output?: any): React.ReactNode | null {
  const normalized = normalizeToolName(toolName);

  if (
    (normalized.includes("write") || normalized.includes("create")) &&
    typeof input?.content === "string"
  ) {
    const lines = toLines(input.content).map((line) => ({
      prefix: "+",
      text: line,
      kind: "add" as const,
    }));
    return renderDiffLines(lines);
  }

  if (normalized.includes("edit") && typeof input?.old_string === "string") {
    const removed = toLines(input.old_string).map((line) => ({
      prefix: "-",
      text: line,
      kind: "remove" as const,
    }));
    const added = toLines(String(input?.new_string || "")).map((line) => ({
      prefix: "+",
      text: line,
      kind: "add" as const,
    }));
    return renderDiffLines([...removed, ...added]);
  }

  if (normalized.includes("multiedit") && Array.isArray(input?.edits)) {
    const blocks = input.edits.slice(0, 3).flatMap((edit: any) => {
      const removed = toLines(String(edit?.old_string || "")).map((line) => ({
        prefix: "-",
        text: line,
        kind: "remove" as const,
      }));
      const added = toLines(String(edit?.new_string || "")).map((line) => ({
        prefix: "+",
        text: line,
        kind: "add" as const,
      }));
      return [...removed, ...added];
    });

    if (blocks.length > 0) {
      return renderDiffLines(blocks);
    }
  }

  if (typeof output?.old_text === "string" || typeof output?.new_text === "string") {
    const removed = toLines(String(output?.old_text || "")).map((line) => ({
      prefix: "-",
      text: line,
      kind: "remove" as const,
    }));
    const added = toLines(String(output?.new_text || "")).map((line) => ({
      prefix: "+",
      text: line,
      kind: "add" as const,
    }));
    return renderDiffLines([...removed, ...added]);
  }

  return null;
}

function renderStatusIcon(status: ToolStatus) {
  if (status === "failed") return <AlertCircle size={10} className="text-red-400" />;
  if (status === "completed") return <CheckCircle size={10} className="text-emerald-400" />;
  if (status === "in_progress")
    return <Clock size={10} className="animate-spin text-text-lighter" />;
  return <Clock size={10} className="text-text-lighter/70" />;
}

export default function ToolCallDisplay({
  toolName,
  input,
  output,
  isStreaming,
  error,
  onOpenInEditor,
}: ToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const status = resolveStatus({ isStreaming, error, output });
  const Icon = useMemo(() => pickToolIcon(toolName), [toolName]);
  const summary = useMemo(() => summarizeTool(toolName, input, output), [toolName, input, output]);
  const filePath = useMemo(() => extractFilePath(input, output), [input, output]);
  const editPreview = useMemo(
    () => buildEditPreview(toolName, input, output),
    [toolName, input, output],
  );

  return (
    <div className="rounded border border-border/70 bg-secondary-bg/50 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Icon size={11} className="text-text-lighter" />
          <span className="truncate font-medium text-text text-xs">{toolName}</span>
          <span className="truncate text-text-lighter text-xs">{summary}</span>

          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
              status === "failed" && "border-red-500/40 text-red-300",
              status === "completed" && "border-emerald-500/40 text-emerald-300",
              status === "in_progress" && "border-border text-text-lighter",
              status === "pending" && "border-border text-text-lighter",
            )}
          >
            {renderStatusIcon(status)}
            {statusLabel(status)}
          </span>

          <ChevronRight
            size={10}
            className={cn(
              "text-text-lighter/60 transition-transform duration-150",
              isExpanded && "rotate-90",
            )}
          />
        </button>

        {filePath && (
          <button
            type="button"
            onClick={() => onOpenInEditor?.(filePath)}
            className="rounded p-0.5 text-text-lighter/70 hover:bg-hover hover:text-text"
            title="Open in editor"
            aria-label="Open in editor"
          >
            <ExternalLink size={10} />
          </button>
        )}
      </div>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {editPreview}

          <div>
            <div className="mb-1 text-[10px] text-text-lighter uppercase tracking-wide">Input</div>
            <pre className="max-h-52 overflow-auto rounded border border-border bg-primary-bg p-2 font-mono text-[11px] text-text-lighter">
              {renderJson(input ?? {})}
            </pre>
          </div>

          {(output !== undefined || error) && (
            <div>
              <div className="mb-1 text-[10px] text-text-lighter uppercase tracking-wide">
                {error ? "Error" : "Output"}
              </div>
              <pre
                className={cn(
                  "max-h-52 overflow-auto rounded border bg-primary-bg p-2 font-mono text-[11px]",
                  error ? "border-red-500/40 text-red-300" : "border-border text-text-lighter",
                )}
              >
                {error ? error : renderJson(output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
