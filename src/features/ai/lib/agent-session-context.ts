import type { GenerativeUIView } from "@/extensions/ui/types/generative-ui";
import { diffTextLines } from "@/features/git/utils/line-diff";
import type { AcpToolKind } from "../types/acp.types";
import type { Chat, Message, ToolCall } from "../types/ai-chat.types";
import { getAcpDiffOutputs, openAcpDiffOutput, toRelativeDisplayPath } from "./acp-diff-output";
import { getStructuredToolViews } from "./structured-tool-view";
import { getToolCallPhase, summarizeToolCall, type ToolCallPhase } from "./tool-call-summary";

/**
 * Everything the side panel knows about one agent session, derived purely
 * from the transcript so it stays correct for hosted and ACP agents alike.
 */
export interface AgentSessionContext {
  /** The most recent tool call, i.e. what the agent is doing right now. */
  focus: AgentSessionFocus | null;
  /** Net change per file across every edit in the session, newest first. */
  changes: AgentSessionChange[];
  /** Files the agent read or searched but did not change, newest first. */
  files: AgentSessionFile[];
  /** Shell commands the agent ran, newest first. */
  commands: AgentSessionCommand[];
  /** Pull requests, issues and links the conversation referenced. */
  resources: AgentSessionResource[];
  /** UI the agent drew, newest first. */
  views: AgentSessionView[];
  additions: number;
  deletions: number;
}

export interface AgentSessionFocus {
  kind: AcpToolKind;
  phase: ToolCallPhase;
  label: string;
  path: string | null;
  displayPath: string | null;
}

export interface AgentSessionChange {
  path: string;
  displayPath: string;
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
  edits: number;
  phase: ToolCallPhase;
  timestamp: number;
}

export interface AgentSessionFile {
  path: string;
  displayPath: string;
  timestamp: number;
}

export interface AgentSessionCommand {
  id: string;
  command: string;
  phase: ToolCallPhase;
  timestamp: number;
}

export type AgentSessionResource =
  | { id: string; kind: "pullRequest"; number: number; label: string; url: string }
  | { id: string; kind: "issue"; number: number; label: string; url: string }
  | { id: string; kind: "link"; label: string; url: string };

export interface AgentSessionView {
  id: string;
  view: GenerativeUIView;
  timestamp: number;
}

const GITHUB_REFERENCE = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)/g;
const LINK = /https?:\/\/[^\s<>()"']+/g;
const MAX_VIEWS = 6;

function toTime(value: Date | number | string | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime() || 0;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function commandOf(toolCall: ToolCall): string | null {
  if (!isRecord(toolCall.input)) return null;
  for (const key of ["command", "cmd", "script"]) {
    const value = toolCall.input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function countNetChanges(oldText: string, newText: string) {
  let additions = 0;
  let deletions = 0;
  for (const op of diffTextLines(oldText, newText)) {
    if (op.type === "added") additions++;
    if (op.type === "removed") deletions++;
  }
  return { additions, deletions };
}

function collectResources(messages: Message[]): AgentSessionResource[] {
  const byId = new Map<string, AgentSessionResource>();

  for (const message of messages) {
    const text = message.content ?? "";
    for (const match of text.matchAll(GITHUB_REFERENCE)) {
      const [url, owner, repo, kind, number] = match;
      const id = `${kind}:${owner}/${repo}#${number}`;
      if (byId.has(id)) continue;
      byId.set(
        id,
        kind === "pull"
          ? { id, kind: "pullRequest", number: Number(number), label: `${repo}#${number}`, url }
          : { id, kind: "issue", number: Number(number), label: `${repo}#${number}`, url },
      );
    }
    for (const match of text.matchAll(LINK)) {
      const url = match[0].replace(/[.,;:!?)]+$/, "");
      if (GITHUB_REFERENCE.test(url)) {
        GITHUB_REFERENCE.lastIndex = 0;
        continue;
      }
      GITHUB_REFERENCE.lastIndex = 0;
      const id = `link:${url}`;
      if (byId.has(id)) continue;
      let label = url;
      try {
        const parsed = new URL(url);
        label = `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
      } catch {
        // keep the raw url as the label
      }
      byId.set(id, { id, kind: "link", label, url });
    }
    for (const resource of message.resources ?? []) {
      if (!/^https?:\/\//.test(resource.uri)) continue;
      const id = `link:${resource.uri}`;
      if (byId.has(id)) continue;
      byId.set(id, { id, kind: "link", label: resource.name || resource.uri, url: resource.uri });
    }
  }

  return Array.from(byId.values());
}

export function buildAgentSessionContext(
  chat: Pick<Chat, "messages"> | null | undefined,
  rootFolderPath: string | null | undefined,
): AgentSessionContext {
  const messages = chat?.messages ?? [];
  const changes = new Map<string, AgentSessionChange>();
  const files = new Map<string, AgentSessionFile>();
  const commands: AgentSessionCommand[] = [];
  const views: AgentSessionView[] = [];
  let latest: ToolCall | null = null;
  let latestStreaming = false;

  for (const message of messages) {
    const messageTime = toTime(message.timestamp);
    for (const view of message.ui ?? []) {
      views.push({ id: `${message.id}:${views.length}`, view, timestamp: messageTime });
    }

    for (const toolCall of message.toolCalls ?? []) {
      const summary = summarizeToolCall(toolCall, {
        isStreaming: message.isStreaming,
        rootFolderPath,
      });
      const timestamp = toTime(toolCall.timestamp) || messageTime;
      latest = toolCall;
      latestStreaming = Boolean(message.isStreaming);

      for (const view of getStructuredToolViews(toolCall.output)) {
        views.push({ id: `${toolCall.id ?? toolCall.name}:${views.length}`, view, timestamp });
      }

      const diffs = getAcpDiffOutputs(toolCall.output);
      if (diffs.length > 0) {
        for (const diff of diffs) {
          const existing = changes.get(diff.path);
          const oldText = existing ? existing.oldText : diff.oldText;
          const { additions, deletions } = countNetChanges(oldText, diff.newText);
          changes.set(diff.path, {
            path: diff.path,
            displayPath: toRelativeDisplayPath(diff.path, rootFolderPath),
            oldText,
            newText: diff.newText,
            additions,
            deletions,
            edits: (existing?.edits ?? 0) + 1,
            phase: summary.phase,
            timestamp,
          });
        }
        continue;
      }

      if (summary.kind === "execute") {
        const command = commandOf(toolCall) ?? summary.target;
        if (command) {
          commands.push({
            id: toolCall.id ?? `${toolCall.name}:${commands.length}`,
            command,
            phase: summary.phase,
            timestamp,
          });
        }
        continue;
      }

      if ((summary.kind === "read" || summary.kind === "search") && summary.path) {
        files.set(summary.path, {
          path: summary.path,
          displayPath: toRelativeDisplayPath(summary.path, rootFolderPath),
          timestamp,
        });
      }
    }
  }

  for (const path of changes.keys()) files.delete(path);

  const byNewest = <T extends { timestamp: number }>(items: T[]) =>
    items.sort((left, right) => right.timestamp - left.timestamp);

  const changeList = byNewest(Array.from(changes.values()));
  const focus: AgentSessionFocus | null = latest
    ? (() => {
        const summary = summarizeToolCall(latest, { isStreaming: latestStreaming, rootFolderPath });
        return {
          kind: summary.kind,
          phase: getToolCallPhase(latest, latestStreaming),
          label: summary.target ? `${summary.verb} ${summary.target}` : summary.verb,
          path: summary.path,
          displayPath: summary.path ? toRelativeDisplayPath(summary.path, rootFolderPath) : null,
        };
      })()
    : null;

  return {
    focus,
    changes: changeList,
    files: byNewest(Array.from(files.values())),
    commands: byNewest(commands),
    resources: collectResources(messages),
    views: byNewest(views).slice(0, MAX_VIEWS),
    additions: changeList.reduce((total, change) => total + change.additions, 0),
    deletions: changeList.reduce((total, change) => total + change.deletions, 0),
  };
}

/** Opens one multibuffer diff with the agent's net change to every file it touched. */
export function openAgentSessionReview(changes: AgentSessionChange[]): string | null {
  return openAcpDiffOutput(
    changes.map((change) => ({
      type: "diff" as const,
      path: change.path,
      oldText: change.oldText,
      newText: change.newText,
    })),
  );
}
