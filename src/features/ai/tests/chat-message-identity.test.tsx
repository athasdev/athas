import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessage } from "@/features/ai/components/chat/chat-message";
import type { Message } from "@/features/ai/types/ai-chat.types";

vi.mock("@/features/ai/components/icons/provider-icons", () => ({
  ProviderIcon: ({ providerId }: { providerId: string }) => (
    <span data-provider-icon={providerId} />
  ),
}));

const identityProps = {
  userName: "Mehmet Özgül",
  userAvatarUrl: "https://example.com/mehmet.png",
  assistantIconId: "codex",
  assistantLabel: "Codex",
};

function message(overrides: Partial<Message>): Message {
  return {
    id: "message-1",
    role: "user",
    content: "Hello",
    timestamp: new Date(0),
    ...overrides,
  };
}

describe("ChatMessage identity", () => {
  it("renders the account avatar with a full-width user message", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage
        message={message({})}
        isLastMessage
        canEditUserMessage
        onEditUserMessage={vi.fn()}
        {...identityProps}
      />,
    );

    expect(markup).toContain('data-slot="avatar"');
    expect(markup).toContain('src="https://example.com/mehmet.png"');
    expect(markup).toContain('data-variant="ghost"');
    expect(markup).toContain('aria-label="Edit prompt"');
    expect(markup).toContain("w-full max-w-full");
    expect(markup.indexOf('data-slot="message-avatar"')).toBeLessThan(
      markup.indexOf('data-slot="message-content"'),
    );
  });

  it("renders the provider identity while an assistant response starts", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage
        message={message({
          role: "assistant",
          content: "",
          isStreaming: true,
          responsePhase: "starting",
        })}
        isLastMessage
        {...identityProps}
      />,
    );

    expect(markup).toContain('aria-label="Codex"');
    expect(markup).toContain('data-provider-icon="codex"');
    expect(markup.indexOf('data-slot="message-avatar"')).toBeLessThan(
      markup.indexOf('data-slot="message-content"'),
    );
    expect(markup).toContain("Starting agent");
  });
});
