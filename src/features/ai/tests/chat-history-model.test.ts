import { describe, expect, it } from "vite-plus/test";
import { filterChatHistory } from "../components/history/chat-history-model";
import type { Chat } from "../types/ai-chat.types";

function chat(id: string, title: string, agentId: string): Chat {
  const timestamp = new Date("2026-08-13T12:00:00Z");

  return {
    id,
    title,
    agentId,
    messages: [],
    createdAt: timestamp,
    lastMessageAt: timestamp,
  };
}

describe("chat history filtering", () => {
  const chats = [
    chat("one", "Review pull request", "codex"),
    chat("two", "Plan migration", "claude-code"),
  ];

  it("matches session titles and agent names", () => {
    expect(filterChatHistory(chats, "pull").map((item) => item.id)).toEqual(["one"]);
    expect(filterChatHistory(chats, "claude").map((item) => item.id)).toEqual(["two"]);
  });

  it("returns every session for an empty query", () => {
    expect(filterChatHistory(chats, "")).toEqual(chats);
  });
});
