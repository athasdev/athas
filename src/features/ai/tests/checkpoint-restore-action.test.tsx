import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChatMessage } from "@/features/ai/components/chat/chat-message";
import type { Message } from "@/features/ai/types/ai-chat.types";

vi.mock("@/features/ai/hooks/use-checkpoint-restore-plan", () => ({
  useCheckpointRestorePlan: (chatId: string | null | undefined) =>
    chatId
      ? { messageIds: ["prompt-1"], files: [{ path: "/p/a.ts", target: "a", expected: "b" }] }
      : null,
}));

const prompt: Message = {
  id: "prompt-1",
  role: "user",
  content: "Change a.ts",
  timestamp: new Date(0),
};

describe("Checkpoint restore action", () => {
  it("offers restoring a prompt whose turn changed files", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage message={prompt} isLastMessage={false} chatId="chat-1" canEditUserMessage />,
    );
    expect(markup).toContain('aria-label="Restore checkpoint"');
  });

  it("hides the restore while the chat cannot take a new turn", () => {
    const markup = renderToStaticMarkup(
      <ChatMessage message={prompt} isLastMessage={false} chatId="chat-1" />,
    );
    expect(markup).not.toContain("Restore checkpoint");
  });
});
