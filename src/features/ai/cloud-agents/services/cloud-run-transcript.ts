import type { AcpPlanEntry } from "@/features/ai/types/acp.types";
import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import type { CloudAgentLogLine } from "./cloud-agents-api";

/** What a run's log reads as in the session: the agent's words, its tool calls and its plan. */
export interface CloudRunTranscript {
  content: string;
  toolCalls: ToolCall[];
  plan: AcpPlanEntry[] | null;
  /** The sandbox's latest progress line, such as cloning or opening the pull request. */
  status: string | null;
}

const MAX_OUTPUT_CHARS = 4000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function clip(output: string) {
  return output.length > MAX_OUTPUT_CHARS ? `…${output.slice(-MAX_OUTPUT_CHARS)}` : output;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

function planStatus(value: unknown): AcpPlanEntry["status"] {
  return value === "completed" || value === "in_progress" ? value : "pending";
}

function readTodos(todos: unknown): AcpPlanEntry[] | null {
  if (!Array.isArray(todos)) return null;
  const entries = todos.flatMap((todo): AcpPlanEntry[] => {
    if (!isRecord(todo)) return [];
    const content = text(todo.content) ?? text(todo.text);
    if (!content) return [];
    const status =
      typeof todo.completed === "boolean"
        ? todo.completed
          ? "completed"
          : "pending"
        : planStatus(todo.status);
    return [{ content, status, priority: "medium" }];
  });
  return entries.length ? entries : null;
}

/**
 * Reads a run's log into a transcript. Claude Code and Codex write one JSON event per line on
 * stdout; Athas's own lines (cloning, pushing, opening the pull request) come on the system stream.
 */
export function buildCloudRunTranscript(lines: readonly CloudAgentLogLine[]): CloudRunTranscript {
  let content = "";
  let plan: AcpPlanEntry[] | null = null;
  let status: string | null = null;
  const toolCalls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();

  const appendText = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    content = content ? `${content}\n\n${trimmed}` : trimmed;
  };

  const upsertTool = (id: string, at: number, patch: Partial<ToolCall> & { name: string }) => {
    const existing = byId.get(id);
    if (existing) {
      Object.assign(existing, patch);
      return existing;
    }
    const call: ToolCall = {
      id,
      input: {},
      timestamp: new Date(at),
      status: "in_progress",
      contentOffset: content.length,
      ...patch,
    };
    byId.set(id, call);
    toolCalls.push(call);
    return call;
  };

  const finishTool = (id: string, output: string, failed: boolean, at: number) => {
    const call = byId.get(id);
    if (!call) return;
    call.output = clip(output);
    call.status = failed ? "failed" : "completed";
    call.isComplete = true;
    call.durationMs = Math.max(0, at - new Date(call.timestamp).getTime());
  };

  lines.forEach((line, index) => {
    if (line.stream === "system") {
      if (line.text.trim()) status = line.text.trim();
      return;
    }
    if (line.stream !== "stdout") return;
    let event: unknown;
    try {
      event = JSON.parse(line.text);
    } catch {
      return;
    }
    if (!isRecord(event)) return;

    if (
      event.type === "assistant" &&
      isRecord(event.message) &&
      Array.isArray(event.message.content)
    ) {
      for (const part of event.message.content) {
        if (!isRecord(part)) continue;
        if (part.type === "text" && typeof part.text === "string") appendText(part.text);
        if (part.type === "tool_use" && typeof part.name === "string") {
          const id = typeof part.id === "string" ? part.id : `tool-${index}`;
          if (part.name === "TodoWrite" && isRecord(part.input)) {
            plan = readTodos(part.input.todos) ?? plan;
            continue;
          }
          upsertTool(id, line.at, {
            name: part.name,
            input: isRecord(part.input) ? part.input : {},
          });
        }
      }
      return;
    }

    if (event.type === "user" && isRecord(event.message) && Array.isArray(event.message.content)) {
      for (const part of event.message.content) {
        if (!isRecord(part) || part.type !== "tool_result" || typeof part.tool_use_id !== "string")
          continue;
        finishTool(part.tool_use_id, toolResultText(part.content), part.is_error === true, line.at);
      }
      return;
    }

    if (event.type === "result") {
      const result = text(event.result);
      if (result && !content.endsWith(result.trim())) appendText(result);
      return;
    }

    if (
      (event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed") &&
      isRecord(event.item)
    ) {
      const item = event.item;
      const id = typeof item.id === "string" ? item.id : `item-${index}`;
      const done = event.type === "item.completed";
      switch (item.type) {
        case "agent_message":
          if (done && typeof item.text === "string") appendText(item.text);
          return;
        case "command_execution": {
          if (typeof item.command !== "string") return;
          upsertTool(id, line.at, {
            name: "Bash",
            kind: "execute",
            input: { command: item.command },
          });
          if (done) {
            const failed =
              item.status === "failed" ||
              (typeof item.exit_code === "number" && item.exit_code !== 0);
            finishTool(
              id,
              typeof item.aggregated_output === "string" ? item.aggregated_output : "",
              failed,
              line.at,
            );
          }
          return;
        }
        case "file_change": {
          const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
          const paths = changes.flatMap((change) =>
            typeof change.path === "string" ? [change.path] : [],
          );
          if (!paths.length) return;
          upsertTool(id, line.at, {
            name: "Edit",
            kind: "edit",
            input:
              paths.length === 1 ? { path: paths[0] } : { description: `${paths.length} files` },
          });
          if (done) finishTool(id, paths.join("\n"), item.status === "failed", line.at);
          return;
        }
        case "mcp_tool_call": {
          const name = [text(item.server), text(item.tool)].filter(Boolean).join(".");
          if (!name) return;
          upsertTool(id, line.at, { name, input: isRecord(item.arguments) ? item.arguments : {} });
          if (done) finishTool(id, "", item.status === "failed", line.at);
          return;
        }
        case "web_search": {
          const query = text(item.query);
          if (!query) return;
          upsertTool(id, line.at, { name: "WebSearch", kind: "fetch", input: { query } });
          if (done) finishTool(id, "", false, line.at);
          return;
        }
        case "todo_list":
          plan = readTodos(item.items) ?? plan;
          return;
        case "error":
          if (done && typeof item.message === "string") status = item.message;
          return;
      }
    }
  });

  return { content, toolCalls, plan, status };
}

/** The log as readable lines, for the run's raw log view. */
export function formatCloudRunLog(lines: readonly CloudAgentLogLine[]): string {
  return lines
    .flatMap((line) => {
      if (line.stream !== "stdout") return [line.text];
      try {
        const event = JSON.parse(line.text) as unknown;
        if (!isRecord(event)) return [line.text];
        if (event.type === "result") return [];
        const single = buildCloudRunTranscript([line]);
        const tools = single.toolCalls.map((call) => {
          const input = isRecord(call.input) ? call.input : {};
          const detail =
            text(input.command) ??
            text(input.file_path) ??
            text(input.path) ??
            text(input.pattern) ??
            "";
          return `→ ${call.name}${detail ? ` ${detail}` : ""}`;
        });
        return [single.content, ...tools].filter(Boolean);
      } catch {
        return [line.text];
      }
    })
    .join("\n");
}
