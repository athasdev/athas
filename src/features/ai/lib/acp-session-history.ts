import { startAssistantResponseContinuation } from "./assistant-response";
import { createToolCall, markToolCallComplete, updateToolCall } from "./tool-call-state";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { Message, ToolCall } from "@/features/ai/types/ai-chat.types";

type HistoryEvent = Extract<
  AcpEvent,
  {
    type:
      | "user_message_chunk"
      | "content_chunk"
      | "thought_chunk"
      | "tool_start"
      | "tool_update"
      | "tool_complete"
      | "plan_update";
  }
>;

type ContentChunk = Extract<AcpEvent, { type: "content_chunk" }>["content"];

const THOUGHT_TOOL_NAME = "Thought";

interface HistoryOptions {
  /** When the conversation ended; messages are timestamped in order just before it. */
  endedAt?: Date;
  createId?: () => string;
}

/**
 * Turns the conversation an agent replayed for `session/load` into chat messages, the way a
 * live turn would have built them: user and agent chunks join into messages, tool calls and
 * plans attach to the agent message they arrived in, and thoughts show as a completed "think"
 * call so the reasoning stays visible without mixing into the answer.
 */
export function acpHistoryToMessages(events: AcpEvent[], options: HistoryOptions = {}): Message[] {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const messages: Message[] = [];
  let thoughtId: string | null = null;
  // The agent's message ids, when it sends them, mark where one message ends and the next starts.
  const lastMessageId = new Map<HistoryEvent["type"], string>();
  const startsNewMessage = (
    event: Extract<
      HistoryEvent,
      { type: "user_message_chunk" | "content_chunk" | "thought_chunk" }
    >,
  ): boolean => {
    if (!event.messageId) return false;
    const previous = lastMessageId.get(event.type);
    lastMessageId.set(event.type, event.messageId);
    return previous !== undefined && previous !== event.messageId;
  };

  const startMessage = (role: Message["role"]): Message => {
    const message: Message = { id: createId(), role, content: "", timestamp: new Date(0) };
    messages.push(message);
    thoughtId = null;
    return message;
  };

  const current = (role: Message["role"]): Message => {
    const last = messages[messages.length - 1];
    return last?.role === role ? last : startMessage(role);
  };

  const holderOf = (toolId: string): Message | undefined => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].toolCalls?.some((toolCall) => toolCall.id === toolId)) {
        return messages[index];
      }
    }
    return undefined;
  };

  const appendContent = (message: Message, content: ContentChunk) => {
    switch (content.type) {
      case "text":
        message.content += content.text;
        break;
      case "image":
        message.images = [
          ...(message.images ?? []),
          { data: content.data, mediaType: content.mediaType },
        ];
        break;
      case "resource":
        message.resources = [
          ...(message.resources ?? []),
          { uri: content.uri, name: content.name },
        ];
        break;
      case "audio":
        break;
    }
  };

  const addToolCall = (message: Message, toolCall: ToolCall) => {
    message.toolCalls = [
      ...(message.toolCalls ?? []),
      { ...toolCall, contentOffset: message.content.length },
    ];
    message.isToolUse = true;
    message.toolName = toolCall.name;
  };

  for (const event of events.filter(isHistoryEvent)) {
    if (event.type !== "thought_chunk") thoughtId = null;

    switch (event.type) {
      case "user_message_chunk": {
        const last = messages[messages.length - 1];
        const message =
          startsNewMessage(event) && last?.role === "user" ? startMessage("user") : current("user");
        appendContent(message, event.content);
        break;
      }
      case "content_chunk": {
        const message = current("assistant");
        if (startsNewMessage(event)) {
          message.content = startAssistantResponseContinuation(message.content);
        }
        appendContent(message, event.content);
        break;
      }
      case "thought_chunk": {
        if (event.content.type !== "text") break;
        if (startsNewMessage(event)) thoughtId = null;
        const message = current("assistant");
        const thought = message.toolCalls?.find((toolCall) => toolCall.id === thoughtId);
        if (thought) {
          thought.output = `${thought.output ?? ""}${event.content.text}`;
          break;
        }
        const id = createId();
        addToolCall(message, {
          id,
          name: THOUGHT_TOOL_NAME,
          input: {},
          output: event.content.text,
          kind: "think",
          status: "completed",
          isComplete: true,
          timestamp: new Date(0),
        });
        thoughtId = id;
        break;
      }
      case "tool_start":
        addToolCall(
          current("assistant"),
          createToolCall(
            event.toolName,
            event.input,
            event.toolId,
            event.kind,
            event.status,
            event.locations,
            event.output,
            event.rawOutput,
          ),
        );
        break;
      case "tool_update": {
        const message = holderOf(event.toolId) ?? current("assistant");
        const known = message.toolCalls?.some((toolCall) => toolCall.id === event.toolId);
        const toolCalls = updateToolCall(message.toolCalls ?? [], {
          id: event.toolId,
          name: event.toolName,
          input: event.input,
          output: event.output,
          rawOutput: event.rawOutput,
          error: event.error,
          kind: event.kind,
          status: event.status,
          locations: event.locations,
        });
        if (known) {
          message.toolCalls = toolCalls;
        } else {
          addToolCall(message, toolCalls[toolCalls.length - 1]);
        }
        break;
      }
      case "tool_complete": {
        const message = holderOf(event.toolId);
        if (!message?.toolCalls) break;
        message.toolCalls = markToolCallComplete(
          message.toolCalls,
          "",
          event.toolId,
          event.output ?? undefined,
          event.error ?? undefined,
        );
        break;
      }
      case "plan_update": {
        const message = current("assistant");
        message.plan = event.entries.length > 0 ? event.entries : undefined;
        break;
      }
    }
  }

  const endedAt = options.endedAt?.getTime() ?? Date.now();
  const kept = messages.filter(
    (message) =>
      message.content.trim() ||
      message.toolCalls?.length ||
      message.images?.length ||
      message.resources?.length ||
      message.plan?.length,
  );
  kept.forEach((message, index) => {
    const timestamp = new Date(endedAt - (kept.length - 1 - index));
    message.timestamp = timestamp;
    for (const toolCall of message.toolCalls ?? []) toolCall.timestamp = timestamp;
  });
  return kept;
}

function isHistoryEvent(event: AcpEvent): event is HistoryEvent {
  switch (event.type) {
    case "user_message_chunk":
    case "content_chunk":
    case "thought_chunk":
    case "tool_start":
    case "tool_update":
    case "tool_complete":
    case "plan_update":
      return true;
    default:
      return false;
  }
}
