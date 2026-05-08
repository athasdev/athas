import {
  WarningCircle as AlertCircle,
  CheckCircle,
  Clock,
  FileText,
  GitDiff,
  TerminalWindow as TerminalSquare,
  Wrench,
} from "@phosphor-icons/react";
import { getAcpDiffOutputs, openAcpDiffOutput } from "@/features/ai/lib/acp-diff-output";
import {
  getAcpTerminalOutputs,
  openAcpTerminalOutput,
} from "@/features/ai/lib/acp-terminal-output";
import type { AcpToolCallLocation, AcpToolCallStatus, AcpToolKind } from "@/features/ai/types/acp";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { getFileDiff } from "@/features/git/api/git-diff-api";
import { useProjectStore } from "@/features/window/stores/project-store";
import { getBaseName, joinPath } from "@/utils/path-helpers";
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

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("remote://");
}

function resolveToolPath(
  locations: AcpToolCallLocation[] | undefined,
  input: unknown,
): string | null {
  const locationPath = locations?.[0]?.path;
  if (locationPath) return locationPath;

  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const path =
    typeof record.file_path === "string"
      ? record.file_path
      : typeof record.path === "string"
        ? record.path
        : typeof record.filename === "string"
          ? record.filename
          : null;

  return path;
}

function resolveWorkspacePath(path: string): string {
  if (isAbsolutePath(path)) return path;
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  return rootFolderPath ? joinPath(rootFolderPath, path) : path;
}

async function openToolPath(path: string) {
  const resolvedPath = resolveWorkspacePath(path);
  const content = await readFileContent(resolvedPath);
  const bufferId = useBufferStore
    .getState()
    .actions.openBuffer(resolvedPath, getBaseName(resolvedPath), content);
  useBufferStore.getState().actions.setActiveBuffer(bufferId);
}

async function openToolDiff(path: string, output: unknown) {
  if (openAcpDiffOutput(output)) return;

  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  const resolvedPath = resolveWorkspacePath(path);
  const repoPath = rootFolderPath ?? resolvedPath;
  const diff = await getFileDiff(repoPath, path);

  if (diff) {
    const displayName = `${getBaseName(diff.file_path)}.diff`;
    useBufferStore
      .getState()
      .actions.openBuffer(
        `diff://acp-tool-output/${Date.now()}`,
        displayName,
        "",
        false,
        undefined,
        true,
        true,
        diff,
      );
    return;
  }

  const newText = await readFileContent(resolvedPath);
  openAcpDiffOutput([{ type: "diff", path: resolvedPath, oldText: "", newText }]);
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
          : Wrench;
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
  const toolPath = resolveToolPath(locations, input);
  const isQuietCompletedTool =
    state === "success" &&
    !hasDiffOutput &&
    !hasTerminalOutput &&
    !error &&
    (kind === "read" || kind === "execute" || kind === "search" || kind === "think");

  if (isQuietCompletedTool) return null;

  const actionButtons = (
    <span className="flex items-center gap-1">
      {toolPath && (kind === "edit" || kind === "delete" || kind === "move" || hasDiffOutput) ? (
        <button
          type="button"
          className="flex size-5 items-center justify-center rounded text-text-lighter/70 hover:bg-hover hover:text-text"
          onClick={(event) => {
            event.stopPropagation();
            void openToolDiff(toolPath, output);
          }}
          title="Open diff"
        >
          <GitDiff size={13} weight="duotone" />
        </button>
      ) : null}
      {toolPath ? (
        <button
          type="button"
          className="flex size-5 items-center justify-center rounded text-text-lighter/70 hover:bg-hover hover:text-text"
          onClick={(event) => {
            event.stopPropagation();
            void openToolPath(toolPath);
          }}
          title="Open file"
        >
          <FileText size={13} weight="duotone" />
        </button>
      ) : null}
      {hasTerminalOutput ? (
        <button
          type="button"
          className="flex size-5 items-center justify-center rounded text-text-lighter/70 hover:bg-hover hover:text-text"
          onClick={(event) => {
            event.stopPropagation();
            openAcpTerminalOutput(output);
          }}
          title="Open terminal"
        >
          <TerminalSquare size={13} weight="duotone" />
        </button>
      ) : null}
    </span>
  );

  return (
    <ChatActivityLine
      icon={<Icon size={13} weight="duotone" />}
      title={toolName}
      detail={detail}
      state={state}
      actions={actionButtons}
    >
      {hasDetails ? (
        <>
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
