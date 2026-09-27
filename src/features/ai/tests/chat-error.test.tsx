import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessage } from "@/features/ai/components/chat/chat-message";
import {
  getChatErrorActions,
  getChatErrorCode,
  parseLegacyErrorBlock,
} from "@/features/ai/lib/chat-error";
import type { Message } from "@/features/ai/types/ai-chat.types";

describe("chat errors", () => {
  it("reads a legacy error block", () => {
    expect(
      parseLegacyErrorBlock(
        "title: No Response\ncode: EMPTY_RESPONSE\nmessage: Nothing came back\ndetails:\nprovider: openai",
      ),
    ).toEqual({
      title: "No Response",
      code: "EMPTY_RESPONSE",
      message: "Nothing came back",
      details: undefined,
      providerId: "openai",
    });
  });

  it("derives the recovery code and actions", () => {
    expect(getChatErrorCode({ message: "x", status: 429 })).toBe("429");
    expect(getChatErrorCode({ message: "Payment Required" })).toBe("402");
    expect(getChatErrorActions({ message: "x", code: "AUTH_REQUIRED" })).toEqual([
      "restart_agent",
      "open_agent_terminal",
    ]);
    expect(getChatErrorActions({ message: "x", code: "429" })).toEqual([
      "provider_settings",
      "retry",
    ]);
    expect(getChatErrorActions({ message: "x", actions: ["retry"] })).toEqual(["retry"]);
    expect(getChatErrorActions({ message: "x", code: "auth_required" })).toEqual([
      "restart_agent",
      "open_agent_terminal",
    ]);
    expect(getChatErrorActions({ message: "x", status: 402, retryable: false })).toEqual([
      "provider_settings",
    ]);
    expect(getChatErrorCode({ message: "x", code: "http_429", status: 429 })).toBe("429");
  });

  it("renders a structured error stored on the message", () => {
    const message: Message = {
      id: "reply",
      role: "assistant",
      content: "",
      timestamp: new Date(0),
      error: {
        title: "Rate Limit Exceeded",
        code: "429",
        message: "Slow down",
        actions: ["retry"],
      },
    };
    const markup = renderToStaticMarkup(
      <ChatMessage message={message} isLastMessage onRetry={vi.fn()} />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Rate Limit Exceeded");
    expect(markup).toContain("Slow down");
    expect(markup).toContain("Try again");
  });

  it("renders the structured error instead of the legacy card kept in the text", () => {
    const message: Message = {
      id: "reply",
      role: "assistant",
      content: "Partly done\n\n[ERROR_BLOCK]\ntitle: Legacy Title\nmessage: Old\n[/ERROR_BLOCK]",
      timestamp: new Date(0),
      error: { title: "Connection Lost", message: "Reconnect and try again" },
    };
    const markup = renderToStaticMarkup(<ChatMessage message={message} isLastMessage />);
    expect(markup).toContain("Partly done");
    expect(markup).toContain("Connection Lost");
    expect(markup).not.toContain("Legacy Title");
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
  });
});
