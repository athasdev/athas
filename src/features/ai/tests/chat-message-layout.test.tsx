import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessage } from "@/features/ai/components/chat/chat-message";
import type { Message } from "@/features/ai/types/ai-chat.types";

function message(overrides: Partial<Message>): Message {
  return {
    id: "message-1",
    role: "user",
    content: "Hello",
    timestamp: new Date(0),
    ...overrides,
  };
}

describe("ChatMessage layout", () => {
  it("offers billing recovery for a previously saved payment error", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage
        message={message({
          role: "assistant",
          content: `Completed the first step.

[ERROR_BLOCK]
title: API Error
code:
message: Failed to connect to athas API: Payment Required
details:
[/ERROR_BLOCK]`,
        })}
        isLastMessage
      />,
    );
    expect(markup).toContain("Manage billing");
    expect(markup).toContain("Completed the first step.");
  });
  it("renders a full-width user message without an avatar", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage
        message={message({})}
        isLastMessage
        canEditUserMessage
        onEditUserMessage={vi.fn()}
      />,
    );

    expect(markup).toContain('data-variant="user"');
    expect(markup).toContain("w-full max-w-full");
    expect(markup).not.toContain('data-slot="message-avatar"');
    // The prompt stays plain selectable text; editing has its own action.
    expect(markup).toMatch(/<div class="select-text[^"]*">Hello<\/div>/);
    expect(markup).toContain('aria-label="Edit prompt"');
  });

  it("renders the starting status without an avatar", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage
        message={message({
          role: "assistant",
          content: "",
          isStreaming: true,
          responsePhase: "starting",
        })}
        isLastMessage
      />,
    );

    expect(markup).not.toContain('data-slot="message-avatar"');
    expect(markup).toContain("Starting agent");
  });

  it("shows a waiting response without claiming the agent is restarting", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage
        message={message({
          role: "assistant",
          content: "",
          isStreaming: true,
          responsePhase: "waiting",
        })}
        isLastMessage
      />,
    );
    expect(markup).toContain("Waiting for response");
    expect(markup).not.toContain("Starting agent");
  });
});
