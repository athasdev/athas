import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AgentEditEntry } from "@/features/ai/types/agent-edits.types";

const mocks = vi.hoisted(() => ({
  choice: vi.fn(),
  rejectAll: vi.fn(),
  clearCheckpoints: vi.fn(async () => {}),
  replaceChatMessages: vi.fn(),
}));

vi.mock("@/ui/dialog", () => ({ showChoiceDialog: mocks.choice }));
vi.mock("@/features/ai/services/agent-edits-service", () => ({
  rejectAllAgentEdits: mocks.rejectAll,
}));
vi.mock("@/features/ai/services/agent-checkpoints-service", () => ({
  clearChatCheckpoints: mocks.clearCheckpoints,
}));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => ({ actions: { replaceChatMessages: mocks.replaceChatMessages } }),
  },
}));

import { clearChat } from "@/features/ai/services/chat-compaction-service";
import { getAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";

const CHAT = "chat-1";

function pendingEdit(path: string): AgentEditEntry {
  return { path, baseline: "a", current: "b", created: false, revision: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rejectAll.mockReset();
  useAgentEditsStore.setState({ byChat: {}, reviewChatId: null });
});

describe("/clear", () => {
  it("clears the messages and checkpoints of a chat with nothing to review", async () => {
    expect(await clearChat(CHAT)).toBe(true);
    expect(mocks.choice).not.toHaveBeenCalled();
    expect(mocks.clearCheckpoints).toHaveBeenCalledWith(CHAT);
    expect(mocks.replaceChatMessages).toHaveBeenCalledWith(CHAT, []);
  });

  it("keeps unreviewed changes on disk when the user keeps them", async () => {
    useAgentEditsStore.getState().actions.setEntry(CHAT, "/a.ts", pendingEdit("/a.ts"));
    useAgentEditsStore.getState().actions.setEntry("other", "/b.ts", pendingEdit("/b.ts"));
    mocks.choice.mockResolvedValue("keep");
    expect(await clearChat(CHAT)).toBe(true);
    expect(mocks.choice.mock.calls[0][0]).toContain("1 file");
    expect(mocks.rejectAll).not.toHaveBeenCalled();
    expect(getAgentEditEntries(CHAT)).toEqual({});
    expect(Object.keys(getAgentEditEntries("other"))).toEqual(["/b.ts"]);
    expect(mocks.clearCheckpoints).toHaveBeenCalledWith(CHAT);
    expect(mocks.replaceChatMessages).toHaveBeenCalledWith(CHAT, []);
  });

  it("reverts unreviewed changes when the user discards them", async () => {
    useAgentEditsStore.getState().actions.setEntry(CHAT, "/a.ts", pendingEdit("/a.ts"));
    mocks.choice.mockResolvedValue("discard");
    mocks.rejectAll.mockImplementation(async (chatId: string) =>
      useAgentEditsStore.getState().actions.setEntry(chatId, "/a.ts", null),
    );
    expect(await clearChat(CHAT)).toBe(true);
    expect(mocks.rejectAll).toHaveBeenCalledWith(CHAT);
    expect(mocks.replaceChatMessages).toHaveBeenCalledWith(CHAT, []);
  });

  it("leaves the chat alone when the choice is dismissed or a revert fails", async () => {
    useAgentEditsStore.getState().actions.setEntry(CHAT, "/a.ts", pendingEdit("/a.ts"));
    mocks.choice.mockResolvedValueOnce(null);
    expect(await clearChat(CHAT)).toBe(false);
    mocks.choice.mockResolvedValueOnce("discard");
    expect(await clearChat(CHAT)).toBe(false);
    expect(Object.keys(getAgentEditEntries(CHAT))).toEqual(["/a.ts"]);
    expect(mocks.clearCheckpoints).not.toHaveBeenCalled();
    expect(mocks.replaceChatMessages).not.toHaveBeenCalled();
  });
});
