import {
  WarningCircle as AlertCircle,
  CheckCircle,
  Clock,
  TerminalWindow as TerminalSquare,
} from "@phosphor-icons/react";
import type { AcpToolCallLocation, AcpToolCallStatus, AcpToolKind } from "@/features/ai/types/acp";
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

function getOutputText(output: unknown): string {
  if (!Array.isArray(output)) return formatValue(output);

  return output
    .map((item) => {
      if (item?.type === "content" && item.content?.type === "text") return item.content.text;
      if (item?.type === "diff") return `Diff: ${item.path}`;
      if (item?.type === "terminal") return `Terminal: ${item.terminalId}`;
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
  const detail = inputSummary ? `${statusLabel} · ${inputSummary}` : statusLabel;
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

  return (
    <ChatActivityLine icon={<Icon size={13} />} title={toolName} detail={detail} state={state}>
      {hasDetails ? (
        <>
          {kind && kind !== "other" ? `kind: ${kind}\n` : ""}
          {locations?.length
            ? `locations:\n${locations
                .map((location) => `  ${location.path}${location.line ? `:${location.line}` : ""}`)
                .join("\n")}\n`
            : ""}
          {input ? `input:\n${formatValue(input)}\n` : ""}
          {output ? `output:\n${getOutputText(output)}\n` : ""}
          {error ? `error:\n${error}` : ""}
        </>
      ) : null}
    </ChatActivityLine>
  );
}
