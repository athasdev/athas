import { getAcpDiffOutputs } from "@/features/ai/lib/acp-diff-output";
import type {
  AcpEvent,
  AcpPermissionPreview,
  AcpPermissionToolCall,
} from "@/features/ai/types/acp.types";

type PermissionRequestEvent = Extract<AcpEvent, { type: "permission_request" }>;

const MAX_SUMMARY_FIELDS = 4;
const MAX_SUMMARY_VALUE_LENGTH = 80;
const MAX_SUMMARY_TEXT_LENGTH = 240;
const SHELL_NAMES = new Set(["sh", "bash", "zsh", "fish", "pwsh", "powershell", "cmd"]);
const SHELL_SCRIPT_FLAGS = new Set(["-c", "-lc", "-ic", "/c", "-Command"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function getShellName(program: string): string {
  const name = program.split(/[\\/]/).pop() ?? program;
  return name.replace(/\.exe$/i, "").toLowerCase();
}

/** A command array like `["bash", "-lc", "ls"]` reads best as the script it runs. */
function formatCommandArray(parts: string[]): string {
  if (
    parts.length === 3 &&
    SHELL_NAMES.has(getShellName(parts[0])) &&
    SHELL_SCRIPT_FLAGS.has(parts[1])
  ) {
    return parts[2];
  }
  return parts.join(" ");
}

/** The shell command an execute call's `rawInput` carries, in the shapes agents send it. */
export function getRawInputCommand(rawInput: unknown): string | null {
  if (!isRecord(rawInput)) return null;
  for (const key of ["command", "cmd"]) {
    const value = rawInput[key];
    if (typeof value === "string" && value.trim()) return value;
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((part) => typeof part === "string")
    ) {
      return formatCommandArray(value);
    }
  }
  return null;
}

function formatSummaryValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.replace(/\s+/g, " ").trim();
    return text ? truncate(text, MAX_SUMMARY_VALUE_LENGTH) : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return truncate(JSON.stringify(value), MAX_SUMMARY_VALUE_LENGTH);
  } catch {
    return null;
  }
}

/** A few `key: value` lines from `rawInput`, enough to see what the call targets. */
export function summarizeRawInput(rawInput: unknown): string | null {
  if (typeof rawInput === "string") {
    return rawInput.trim() ? truncate(rawInput.trim(), MAX_SUMMARY_TEXT_LENGTH) : null;
  }
  if (!isRecord(rawInput)) return formatSummaryValue(rawInput);

  const entries = Object.entries(rawInput).flatMap(([key, value]) => {
    const formatted = formatSummaryValue(value);
    return formatted ? [`${key}: ${formatted}`] : [];
  });
  if (entries.length === 0) return null;
  const hidden = entries.length - MAX_SUMMARY_FIELDS;
  const shown = entries.slice(0, MAX_SUMMARY_FIELDS);
  return (hidden > 0 ? [...shown, `+${hidden} more`] : shown).join("\n");
}

function getContentText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const texts = content.flatMap((item) => {
    if (!isRecord(item) || item.type !== "content" || !isRecord(item.content)) return [];
    const block = item.content;
    return block.type === "text" && typeof block.text === "string" && block.text.trim()
      ? [block.text.trim()]
      : [];
  });
  return texts.length > 0 ? texts.join("\n\n") : null;
}

/** Reduces an ACP permission request's tool call to what the permission prompt shows. */
export function buildAcpToolCallPreview(
  toolCall: AcpPermissionToolCall,
): AcpPermissionPreview | undefined {
  const kind = toolCall.kind ?? null;
  const diffs = getAcpDiffOutputs(toolCall.content);
  const command =
    diffs.length === 0 && (kind === "execute" || kind === null || kind === "other")
      ? getRawInputCommand(toolCall.rawInput)
      : null;
  const text = getContentText(toolCall.content);
  const locations = toolCall.locations ?? [];
  const inputSummary =
    diffs.length === 0 && !command && !text ? summarizeRawInput(toolCall.rawInput) : null;

  if (diffs.length === 0 && !command && !text && locations.length === 0 && !inputSummary) {
    return undefined;
  }

  return {
    type: "tool_call",
    title: toolCall.title?.trim() || null,
    kind,
    diffs,
    command,
    text,
    locations,
    inputSummary,
  };
}

/** The preview for any permission request: the one it brought, or one built from its tool call. */
export function getAcpPermissionPreview(
  event: PermissionRequestEvent,
): AcpPermissionPreview | undefined {
  if (event.preview) return event.preview;
  return event.toolCall ? buildAcpToolCallPreview(event.toolCall) : undefined;
}
