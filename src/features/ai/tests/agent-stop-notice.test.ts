import { describe, expect, it } from "vite-plus/test";
import {
  AGENT_CONTINUE_PROMPT,
  getAgentStopNotice,
  parseAgentStopNotice,
} from "@/features/ai/lib/agent-stop-notice";
import { coalesceAssistantResponses } from "@/features/ai/lib/assistant-response";
import { getFollowUpActionsForMessage } from "@/features/ai/lib/follow-up-actions";
import type { Message, ToolCall } from "@/features/ai/types/ai-chat.types";

function assistant(overrides: Partial<Message> = {}): Message {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "Partial answer",
    timestamp: new Date("2026-09-25T12:00:00Z"),
    ...overrides,
  };
}

function tool(overrides: Partial<ToolCall>): ToolCall {
  return {
    id: "tool-1",
    name: "read_file",
    input: {},
    timestamp: new Date("2026-09-25T12:00:00Z"),
    ...overrides,
  };
}

describe("agent stop notices", () => {
  it("treats end_turn, cancelled and a missing reason as ordinary endings", () => {
    expect(getAgentStopNotice("end_turn", assistant())).toBeUndefined();
    expect(getAgentStopNotice("cancelled", assistant())).toBeUndefined();
    expect(getAgentStopNotice(undefined, assistant())).toBeUndefined();
  });

  it("reports the output and turn request limits", () => {
    expect(getAgentStopNotice("max_tokens", assistant())).toBe("max_tokens");
    expect(getAgentStopNotice("max_turn_requests", assistant())).toBe("max_turn_requests");
  });

  it("treats a refusal before any tool output as a refused prompt", () => {
    expect(getAgentStopNotice("refusal", assistant({ content: "" }))).toBe("prompt_refused");
    expect(
      getAgentStopNotice("refusal", assistant({ toolCalls: [tool({ status: "in_progress" })] })),
    ).toBe("prompt_refused");
    expect(
      getAgentStopNotice("refusal", assistant({ toolCalls: [tool({ status: "completed" })] })),
    ).toBe("prompt_refused");
  });

  it("treats a refusal after completed tool output as a refusal to continue", () => {
    expect(
      getAgentStopNotice(
        "refusal",
        assistant({ toolCalls: [tool({ status: "completed", output: "secret file" })] }),
      ),
    ).toBe("refused");
  });

  it("offers Continue only for turns cut short by a limit", () => {
    const continueActions = getFollowUpActionsForMessage(assistant({ stopNotice: "max_tokens" }));
    expect(continueActions.map((action) => action.prompt)).toEqual([AGENT_CONTINUE_PROMPT]);
    expect(
      getFollowUpActionsForMessage(assistant({ stopNotice: "max_turn_requests" }))[0]?.label,
    ).toBe("Continue");
    expect(getFollowUpActionsForMessage(assistant({ stopNotice: "prompt_refused" }))).toEqual([]);
    expect(
      getFollowUpActionsForMessage(assistant({ stopNotice: "max_tokens", isStreaming: true })),
    ).toEqual([]);
  });

  it("restores only known notices from history and keeps them when replies merge", () => {
    expect(parseAgentStopNotice("refused")).toBe("refused");
    expect(parseAgentStopNotice("end_turn")).toBeUndefined();
    expect(parseAgentStopNotice(null)).toBeUndefined();

    const [merged] = coalesceAssistantResponses([
      assistant({ id: "a" }),
      assistant({ id: "b", content: "more", stopNotice: "max_tokens" }),
    ]);
    expect(merged.stopNotice).toBe("max_tokens");
  });
});
