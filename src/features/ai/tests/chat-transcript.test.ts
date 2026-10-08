import { describe, expect, it } from "vite-plus/test";
import { formatChatTranscript } from "../lib/chat-transcript";
import type { Chat, Message } from "../types/ai-chat.types";

function transcript(messages: Message[], title = "Fix the app") {
  return formatChatTranscript({ title, messages } as Chat);
}

describe("conversation Markdown", () => {
  it("preserves text and tool activity in their original order", () => {
    const text = transcript([
      {
        id: "reply",
        role: "assistant",
        content: "Before. After.",
        timestamp: new Date(),
        toolCalls: [
          {
            id: "call-18",
            name: "read_file",
            input: { path: "app.ts" },
            output: "export const x = 1",
            status: "completed",
            contentOffset: 7,
            timestamp: new Date(),
          },
        ],
      },
    ]);
    expect(text.indexOf("Before.")).toBeLessThan(text.indexOf("### Tool: read_file"));
    expect(text.indexOf("### Tool: read_file")).toBeLessThan(text.indexOf("After."));
    expect(text).toContain("export const x = 1");
  });

  it("keeps fences intact and describes images without embedding their payloads", () => {
    const text = transcript([
      {
        id: "prompt",
        role: "user",
        content: "Inspect this.",
        timestamp: new Date(),
        images: [{ mediaType: "image/png", data: "PRIVATE_IMAGE_DATA" }],
      },
      {
        id: "reply",
        role: "assistant",
        content: "",
        timestamp: new Date(),
        toolCalls: [
          {
            id: "call-49",
            name: "terminal",
            input: {},
            output: "`````\noutput",
            timestamp: new Date(),
          },
        ],
      },
    ]);
    expect(text).toContain("Attachments: image/png");
    expect(text).not.toContain("PRIVATE_IMAGE_DATA");
    expect(text).toContain("``````text\n`````\noutput\n``````");
  });

  it("includes incomplete replies, plan status, stop reasons and structured errors", () => {
    const text = transcript(
      [
        {
          id: "reply",
          role: "assistant",
          content: "Working",
          timestamp: new Date(),
          isStreaming: true,
          plan: [{ content: "Run checks", priority: "high", status: "completed" }],
          stopNotice: "max_tokens",
          error: { message: "Offline", details: "Network unreachable" },
        },
      ],
      " \n ",
    );
    expect(text).toContain("# Untitled agent");
    expect(text).toContain("## Agent (in progress)");
    expect(text).toContain("- [x] Run checks");
    expect(text).toContain("output limit");
    expect(text).toContain("Network unreachable");
  });

  it("survives cyclic tool output and empty conversations", () => {
    const output: Record<string, unknown> = {};
    output.self = output;
    expect(
      transcript([
        {
          id: "reply",
          role: "assistant",
          content: "",
          timestamp: new Date(),
          toolCalls: [{ id: "call-91", name: "tool", input: output, timestamp: new Date() }],
        },
      ]),
    ).toContain("could not be serialized");
    expect(transcript([])).toBe("# Fix the app\n");
  });
});
