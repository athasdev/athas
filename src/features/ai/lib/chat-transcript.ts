import { buildAssistantTimeline } from "./assistant-timeline";
import { describeAgentStopNotice } from "./agent-stop-notice";
import type { Chat, Message, ToolCall } from "../types/ai-chat.types";

function fenced(text: string, language = "text"): string {
  const runs = text.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}${language}\n${text}\n${fence}`;
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "[Output could not be serialized]";
  }
}

function formatTool(call: ToolCall): string {
  const state = call.status ?? (call.isComplete ? "completed" : "pending");
  const sections = [`### Tool: ${call.name.replace(/\s+/g, " ")} (${state})`];
  if (call.input !== undefined) sections.push(`Input:\n\n${fenced(serialize(call.input))}`);
  const output = call.output ?? call.rawOutput;
  if (output !== undefined) sections.push(`Output:\n\n${fenced(serialize(output))}`);
  if (call.error) sections.push(`Error:\n\n${fenced(call.error)}`);
  for (const terminal of Object.values(call.terminals ?? {})) {
    sections.push(`Terminal output:\n\n${fenced(terminal.output)}`);
  }
  return sections.join("\n\n");
}

function formatMessage(message: Message): string {
  const role = message.role === "user" ? "You" : message.role === "assistant" ? "Agent" : "System";
  const sections = [`## ${role}${message.isStreaming ? " (in progress)" : ""}`];
  for (const segment of buildAssistantTimeline(message.content, message.toolCalls)) {
    if (segment.text) sections.push(segment.text);
    sections.push(...segment.toolCalls.map(formatTool));
  }
  if (message.images?.length) {
    sections.push(`Attachments: ${message.images.map((image) => image.mediaType).join(", ")}`);
  }
  if (message.plan?.length) {
    sections.push(
      `### Plan\n\n${message.plan.map((step) => `- [${step.status === "completed" ? "x" : " "}] ${step.content}`).join("\n")}`,
    );
  }
  if (message.stopNotice) sections.push(describeAgentStopNotice(message.stopNotice).title);
  if (message.error) {
    sections.push(
      `Error:\n\n${fenced([message.error.title, message.error.message, message.error.details].filter(Boolean).join("\n"))}`,
    );
  }
  return sections.join("\n\n");
}

export function formatChatTranscript(chat: Chat): string {
  const title = chat.title.trim().replace(/\s+/g, " ") || "Untitled agent";
  return [`# ${title}`, ...chat.messages.map(formatMessage)].join("\n\n---\n\n") + "\n";
}
