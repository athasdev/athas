import {
  WarningCircle as AlertCircle,
  CheckCircle,
  Clock,
  TerminalWindow as TerminalSquare,
} from "@phosphor-icons/react";
import { getAcpDiffOutputs, openAcpDiffOutput } from "@/features/ai/lib/acp-diff-output";
import {
  getAcpTerminalOutputs,
  openAcpTerminalOutput,
} from "@/features/ai/lib/acp-terminal-output";
import type { AcpToolCallLocation, AcpToolCallStatus, AcpToolKind } from "@/features/ai/types/acp";
import { Button } from "@/ui/button";
import { ChatActivityLine } from "../chat/chat-activity-line";

interface ToolCallDisplayProps {
  toolName: string;
  input?: unknown;
  output?: unknown;
  isStreaming?: boolean;
  error?: string;
  kind?: AcpToolKind;
  status?: AcpToolCallStatus;
  locations?: AcpToolCallLocation[];
}

function getStatus(
  isStreaming?: boolean,
  error?: string,
  protocolStatus?: AcpToolCallStatus,
): "running" | "success" | "error" | "info" {
  if (error || protocolStatus === "failed") return "error";
  if (protocolStatus === "completed") return "success";
  if (protocolStatus === "pending" || protocolStatus === "in_progress" || isStreaming) {
    return "running";
  }
  return "success";
}

function getStatusLabel(status: ReturnType<typeof getStatus>, protocolStatus?: AcpToolCallStatus) {
  if (status === "error") return "failed";
  if (protocolStatus === "pending") return "pending";
  if (status === "running") return "running";
  return "completed";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getBaseName(path: string): string {
  return path.split("/").pop() || path;
}

function getInputSummary(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return typeof input === "string" ? input : null;
  const record = input as Record<string, unknown>;
  const path =
    typeof record.file_path === "string"
      ? record.file_path
      : typeof record.path === "string"
        ? record.path
        : null;
  if (path) return path.split("/").pop() || path;
  if (toolName.toLowerCase().includes("bash") && typeof record.command === "string") {
    return record.command;
  }
  return null;
}

function getDiffItems(output: unknown) {
  return getAcpDiffOutputs(output);
}

function getTerminalItems(output: unknown) {
  return getAcpTerminalOutputs(output);
}

function getContentText(item: Record<string, unknown>): string {
  if (item.type !== "content" || !isRecord(item.content)) return "";
  if (item.content.type === "text" && typeof item.content.text === "string") {
    return item.content.text;
  }
  return formatValue(item.content);
}

function formatDiffText(item: Record<string, unknown>): string {
  const path = typeof item.path === "string" ? item.path : "file";
  const oldText = typeof item.oldText === "string" ? item.oldText : "";
  const newText = typeof item.newText === "string" ? item.newText : "";

  return [`diff: ${path}`, "--- before", oldText, "+++ after", newText]
    .filter((line) => line.length > 0)
    .join("\n");
}

function formatAcpDiffText(item: ReturnType<typeof getAcpDiffOutputs>[number]): string {
  return [`diff: ${item.path}`, "--- before", item.oldText, "+++ after", item.newText]
    .filter((line) => line.length > 0)
    .join("\n");
}

function getOutputSummary(output: unknown): string | null {
  const diffItems = getDiffItems(output);
  if (diffItems.length > 0) {
    const file = getBaseName(diffItems[0].path);
    return diffItems.length === 1 ? `changed ${file}` : `changed ${diffItems.length} files`;
  }

  const terminalItems = getTerminalItems(output);
  if (terminalItems.length > 0) {
    return terminalItems.length === 1 ? "terminal output" : `${terminalItems.length} terminals`;
  }

  return null;
}

function getOutputText(output: unknown): string {
  if (!Array.isArray(output)) return formatValue(output);

  return output
    .map((item) => {
      if (!isRecord(item)) return formatValue(item);
      if (item.type === "content") return getContentText(item);
      if (item.type === "diff") return formatDiffText(item);
      if (item.type === "terminal" && typeof item.terminalId === "string") {
        return `terminal: ${item.terminalId}`;
      }
      return formatValue(item);
    })
    .filter(Boolean)
    .join("\n\n");
}

export default function ToolCallDisplay({
  toolName,
  input,
  output,
  isStreaming,
  error,
  kind,
  status: protocolStatus,
  locations,
}: ToolCallDisplayProps) {
  const state = getStatus(isStreaming, error, protocolStatus);
  const statusLabel = getStatusLabel(state, protocolStatus);
  const inputSummary = getInputSummary(toolName, input);
  const outputSummary = getOutputSummary(output);
  const summary = outputSummary ?? inputSummary;
  const detail = summary ? `${statusLabel} · ${summary}` : statusLabel;
  const Icon =
    state === "error"
      ? AlertCircle
      : state === "success"
        ? CheckCircle
        : state === "running"
          ? Clock
          : TerminalSquare;
  const hasDetails =
    Boolean(input) ||
    Boolean(output) ||
    Boolean(error) ||
    Boolean(kind && kind !== "other") ||
    Boolean(locations?.length);
  const diffItems = getDiffItems(output);
  const hasDiffOutput = diffItems.length > 0;
  const terminalItems = getTerminalItems(output);
  const hasTerminalOutput = terminalItems.length > 0;

  return (
    <ChatActivityLine icon={<Icon size={13} />} title={toolName} detail={detail} state={state}>
      {hasDetails ? (
        <>
          {hasDiffOutput || hasTerminalOutput ? (
            <div className="ui-font mb-2 flex flex-wrap gap-1.5">
              {hasDiffOutput ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => openAcpDiffOutput(output)}
                  className="h-6 rounded-md border border-border/60 bg-transparent px-2 text-text-lighter hover:border-border hover:bg-hover/60 hover:text-text"
                >
                  Open diff
                </Button>
              ) : null}
              {hasTerminalOutput ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => openAcpTerminalOutput(output)}
                  className="h-6 rounded-md border border-border/60 bg-transparent px-2 text-text-lighter hover:border-border hover:bg-hover/60 hover:text-text"
                >
                  Open terminal
                </Button>
              ) : null}
            </div>
          ) : null}
          {kind && kind !== "other" ? `kind: ${kind}\n` : ""}
          {locations?.length
            ? `locations:\n${locations
                .map((location) => `  ${location.path}${location.line ? `:${location.line}` : ""}`)
                .join("\n")}\n`
            : ""}
          {input ? `input:\n${formatValue(input)}\n` : ""}
          {output
            ? `output:\n${
                hasDiffOutput
                  ? diffItems.map(formatAcpDiffText).join("\n\n")
                  : getOutputText(output)
              }\n`
            : ""}
          {error ? `error:\n${error}` : ""}
        </>
      ) : null}
    </ChatActivityLine>
  );
}
