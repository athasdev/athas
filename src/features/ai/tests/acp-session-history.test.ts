import { describe, expect, it } from "vite-plus/test";
import { acpHistoryToMessages } from "@/features/ai/lib/acp-session-history";
import type { AcpEvent } from "@/features/ai/types/acp.types";

const sessionId = "imported";

const user = (text: string, messageId?: string): AcpEvent => ({
  type: "user_message_chunk",
  sessionId,
  content: { type: "text", text },
  isComplete: false,
  messageId,
});

const agent = (text: string, messageId?: string): AcpEvent => ({
  type: "content_chunk",
  sessionId,
  content: { type: "text", text },
  isComplete: false,
  messageId,
});

const thought = (text: string, messageId?: string): AcpEvent => ({
  type: "thought_chunk",
  sessionId,
  content: { type: "text", text },
  isComplete: false,
  messageId,
});

function convert(events: AcpEvent[]) {
  let next = 0;
  return acpHistoryToMessages(events, {
    endedAt: new Date("2026-09-01T12:00:00Z"),
    createId: () => `id-${next++}`,
  });
}

describe("acpHistoryToMessages", () => {
  it("joins replayed chunks into alternating user and agent messages", () => {
    const messages = convert([
      user("Fix the "),
      user("build"),
      agent("Looking "),
      agent("at it."),
      user("Thanks"),
      agent("Done."),
    ]);

    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Fix the build" },
      { role: "assistant", content: "Looking at it." },
      { role: "user", content: "Thanks" },
      { role: "assistant", content: "Done." },
    ]);
    const times = messages.map((message) => message.timestamp.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[times.length - 1]).toBe(new Date("2026-09-01T12:00:00Z").getTime());
  });

  it("attaches tool calls, their updates and plans to the agent message", () => {
    const [, answer] = convert([
      user("Run the tests"),
      agent("Running them."),
      {
        type: "tool_start",
        sessionId,
        toolName: "Run tests",
        toolId: "tool-1",
        input: { command: "bun test" },
        kind: "execute",
        status: "in_progress",
        locations: [],
      },
      {
        type: "tool_update",
        sessionId,
        toolId: "tool-1",
        status: "completed",
        output: [{ type: "content", content: { type: "text", text: "12 passed" } }],
      },
      {
        type: "plan_update",
        sessionId,
        entries: [{ content: "Run tests", priority: "high", status: "completed" }],
      },
      agent(" All green."),
    ]);

    expect(answer.role).toBe("assistant");
    expect(answer.content).toBe("Running them. All green.");
    expect(answer.toolCalls).toHaveLength(1);
    expect(answer.toolCalls?.[0]).toMatchObject({
      id: "tool-1",
      name: "Run tests",
      status: "completed",
      isComplete: true,
      contentOffset: "Running them.".length,
    });
    expect(answer.plan).toEqual([{ content: "Run tests", priority: "high", status: "completed" }]);
  });

  it("keeps a run of thought chunks as one completed think call", () => {
    const [, answer] = convert([
      user("Why?"),
      thought("Considering "),
      thought("options."),
      agent("Because."),
    ]);

    expect(answer.content).toBe("Because.");
    expect(answer.toolCalls).toEqual([
      expect.objectContaining({
        name: "Thought",
        kind: "think",
        output: "Considering options.",
        isComplete: true,
        contentOffset: 0,
      }),
    ]);
  });

  it("finishes a replayed tool call and ignores session state updates", () => {
    const [answer] = convert([
      { type: "current_mode_update", sessionId, currentModeId: "code" },
      {
        type: "tool_start",
        sessionId,
        toolName: "Read file",
        toolId: "tool-2",
        input: {},
        kind: "read",
        status: "pending",
        locations: [],
      },
      { type: "tool_complete", sessionId, toolId: "tool-2", success: false, error: "Missing" },
      { type: "usage_update", sessionId, usage: { used: 1, size: 10 } },
    ]);

    expect(answer.toolCalls?.[0]).toMatchObject({
      id: "tool-2",
      status: "failed",
      error: "Missing",
      isComplete: true,
    });
  });

  it("splits messages where the agent's message ids change", () => {
    const messages = convert([
      user("first", "u1"),
      user(" question", "u1"),
      user("second question", "u2"),
      thought("plan", "t1"),
      thought("recheck", "t2"),
      agent("Answer one.", "a1"),
      agent("Answer two.", "a2"),
    ]);

    expect(messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "first question"],
      ["user", "second question"],
      ["assistant", "Answer one.\n\nAnswer two."],
    ]);
    expect(messages[2].toolCalls?.map((toolCall) => toolCall.output)).toEqual(["plan", "recheck"]);
  });

  it("keeps a replayed terminal's output with its tool call", () => {
    const messages = convert([
      user("List files"),
      { type: "terminal_started", sessionId, terminalId: "t1", cwd: null, displayOnly: true },
      {
        type: "tool_start",
        sessionId,
        toolName: "ls",
        toolId: "call-1",
        input: {},
        output: [{ type: "terminal", terminalId: "t1" }],
        kind: "execute",
        status: "in_progress",
        locations: [],
      },
      { type: "terminal_output", sessionId, terminalId: "t1", data: "a.txt\n" },
      { type: "terminal_exit", sessionId, terminalId: "t1", exitCode: 0, signal: null },
    ]);

    expect(messages[1].toolCalls?.[0].terminals).toEqual({
      t1: { output: "a.txt\n", truncated: false, exit: { exitCode: 0, signal: null } },
    });
  });

  it("returns no messages for an empty replay", () => {
    expect(convert([])).toEqual([]);
  });
});
