import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import type { AcpToolKind } from "@/features/ai/types/acp.types";
import { getAcpDiffOutputs, toRelativeDisplayPath } from "./acp-diff-output";
import { diffTextLines } from "@/features/git/utils/line-diff";

export type ToolCallPhase = "running" | "done" | "failed" | "declined";

export interface ToolCallSummary {
  kind: AcpToolKind;
  phase: ToolCallPhase;
  /** Past or present tense verb, e.g. "Read" / "Reading". */
  verb: string;
  /** What the verb applies to: a path, a command, a query. */
  target: string | null;
  /** Absolute or workspace-relative path this call touched, when it touched one. */
  path: string | null;
  additions: number;
  deletions: number;
  /** Number of results for searches and listings. */
  count: number | null;
  error: string | null;
}

const VERBS: Record<AcpToolKind, [running: string, done: string]> = {
  read: ["Reading", "Read"],
  edit: ["Editing", "Edited"],
  delete: ["Deleting", "Deleted"],
  move: ["Moving", "Moved"],
  search: ["Searching", "Searched"],
  execute: ["Running", "Ran"],
  think: ["Thinking", "Thought"],
  fetch: ["Fetching", "Fetched"],
  switch_mode: ["Switching mode", "Switched mode"],
  other: ["Calling", "Called"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** Older history rows and some agents only give a name; read the kind off it. */
export function inferToolKind(name: string): AcpToolKind {
  const lower = name.toLowerCase();
  if (/(^|[^a-z])(edit|write|replace|patch|create|apply)/.test(lower)) return "edit";
  if (/(^|[^a-z])(delete|remove|rm)([^a-z]|$)/.test(lower)) return "delete";
  if (/(^|[^a-z])(move|rename)/.test(lower)) return "move";
  if (/(^|[^a-z])(read|view|cat|open)/.test(lower)) return "read";
  if (/(^|[^a-z])(bash|shell|command|exec|run|terminal)/.test(lower)) return "execute";
  if (/(^|[^a-z])(grep|glob|search|find|list|ls)([^a-z]|$)/.test(lower)) return "search";
  if (/(^|[^a-z])(fetch|http|web|url|browse)/.test(lower)) return "fetch";
  if (/(^|[^a-z])(think|plan|reason)/.test(lower)) return "think";
  return "other";
}

function wasDeclined(output: unknown): boolean {
  return isRecord(output) && (output.applied === false || output.executed === false);
}

export function getToolCallPhase(toolCall: ToolCall, isStreaming?: boolean): ToolCallPhase {
  if (toolCall.error || toolCall.status === "failed") return "failed";
  if (wasDeclined(toolCall.output)) return "declined";
  if (toolCall.status === "completed" || toolCall.isComplete) return "done";
  if (toolCall.status === "pending" || toolCall.status === "in_progress") return "running";
  return isStreaming ? "running" : "done";
}

function firstLine(value: string, max = 96): string {
  const line = value.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function countChanges(oldText: string, newText: string) {
  let additions = 0;
  let deletions = 0;
  for (const op of diffTextLines(oldText, newText)) {
    if (op.type === "added") additions += 1;
    else if (op.type === "removed") deletions += 1;
  }
  return { additions, deletions };
}

export function resolveToolCallPath(toolCall: ToolCall): string | null {
  const location = toolCall.locations?.[0]?.path;
  if (location) return location;
  if (!isRecord(toolCall.input)) return null;
  return firstString(toolCall.input, ["file_path", "path", "filename", "filePath"]);
}

export function summarizeToolCall(
  toolCall: ToolCall,
  options: { isStreaming?: boolean; rootFolderPath?: string | null } = {},
): ToolCallSummary {
  const kind =
    toolCall.kind && toolCall.kind !== "other" ? toolCall.kind : inferToolKind(toolCall.name);
  const phase = getToolCallPhase(toolCall, options.isStreaming);
  const input = isRecord(toolCall.input) ? toolCall.input : {};
  const diffs = getAcpDiffOutputs(toolCall.output);
  const path = diffs[0]?.path ?? resolveToolCallPath(toolCall);
  const displayPath = path ? toRelativeDisplayPath(path, options.rootFolderPath) : null;

  let additions = 0;
  let deletions = 0;
  for (const diff of diffs) {
    const changes = countChanges(diff.oldText, diff.newText);
    additions += changes.additions;
    deletions += changes.deletions;
  }

  let target: string | null = null;
  let count: number | null = null;
  switch (kind) {
    case "read":
    case "edit":
    case "delete":
    case "move":
      target =
        diffs.length > 1
          ? `${diffs.length} files`
          : (displayPath ?? firstString(input, ["description", "title"]));
      break;
    case "search": {
      const query = firstString(input, ["query", "pattern", "regex", "glob", "q"]);
      target = query ? `"${firstLine(query, 64)}"` : displayPath;
      if (Array.isArray(toolCall.output)) count = toolCall.output.length;
      break;
    }
    case "execute":
      target = firstString(input, ["command", "cmd", "description"]);
      target = target ? firstLine(target) : null;
      break;
    case "fetch":
      target = firstString(input, ["url", "uri", "query"]);
      target = target ? firstLine(target) : null;
      break;
    case "think":
      target = null;
      break;
    default:
      target = displayPath ?? firstString(input, ["description", "title", "query", "command"]);
      target = target ? firstLine(target) : null;
  }

  const verb = kind === "other" ? toolCall.name : VERBS[kind][phase === "running" ? 0 : 1];

  return {
    kind,
    phase,
    verb,
    target,
    path,
    additions,
    deletions,
    count,
    error: toolCall.error ? firstLine(toolCall.error, 160) : null,
  };
}
