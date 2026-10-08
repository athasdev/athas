import type { CloudAgentLogLine } from "./cloud-agents-api";

type AgentEvent = {
  type?: string;
  subtype?: string;
  result?: unknown;
  message?: { content?: Array<{ type?: string; text?: unknown; name?: unknown; input?: unknown }> };
  item?: { type?: string; text?: unknown; command?: unknown };
};

function describeToolInput(input: unknown) {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const detail = record.command ?? record.file_path ?? record.path ?? record.pattern;
  return typeof detail === "string" ? ` ${detail}` : "";
}

/**
 * Turns one line of a run's log into readable text. Claude Code and Codex write one JSON event
 * per line; events that carry nothing worth reading return null, and plain text passes through.
 */
export function formatCloudAgentLogLine(line: CloudAgentLogLine): string | null {
  if (line.stream !== "stdout") return line.text;
  let event: AgentEvent;
  try {
    event = JSON.parse(line.text) as AgentEvent;
  } catch {
    return line.text;
  }
  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    const parts = event.message.content.flatMap((part) => {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim())
        return [part.text.trim()];
      if (part.type === "tool_use" && typeof part.name === "string")
        return [`→ ${part.name}${describeToolInput(part.input)}`];
      return [];
    });
    return parts.length ? parts.join("\n") : null;
  }
  if (event.type === "result" && typeof event.result === "string") return event.result;
  if (event.type === "item.completed" && event.item) {
    if (event.item.type === "agent_message" && typeof event.item.text === "string")
      return event.item.text;
    if (event.item.type === "command_execution" && typeof event.item.command === "string")
      return `→ ${event.item.command}`;
  }
  return null;
}
