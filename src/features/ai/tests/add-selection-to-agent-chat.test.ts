import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";

const mocks = vi.hoisted(() => ({
  currentChatId: "chat-1" as string | null,
  chats: [{ id: "chat-1", agentId: "custom" }] as { id: string; agentId: string }[],
  setPendingAgentLaunchRequest: vi.fn(),
  openAgentBuffer: vi.fn((chatId: string) => `agent://${chatId}`),
  openNewAgentChat: vi.fn(() => "agent://new"),
  selection: undefined as unknown,
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => ({
      currentChatId: mocks.currentChatId,
      chats: mocks.chats,
      actions: { setPendingAgentLaunchRequest: mocks.setPendingAgentLaunchRequest },
    }),
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      activeBufferId: "buffer-1",
      buffers: [
        {
          id: "buffer-1",
          type: "editor",
          path: "/project/src/app.ts",
          name: "app.ts",
          content: "const a = 1;\nconst b = 2;\n",
        },
      ],
      actions: { openAgentBuffer: mocks.openAgentBuffer },
    }),
  },
}));
vi.mock("@/features/editor/stores/state.store", () => ({
  useEditorStateStore: { getState: () => ({ selection: mocks.selection }) },
}));
vi.mock("@/features/ai/detached/agent-window-service", () => ({
  openAgentWindowSession: () => null,
}));
vi.mock("@/features/ai/lib/open-new-agent-chat", () => ({
  openNewAgentChat: mocks.openNewAgentChat,
}));

import {
  addActiveSelectionToAgentChat,
  addActiveSelectionToNewAgentChat,
  addEditorSelectionsToAgentChat,
} from "@/features/ai/lib/add-selection-to-agent-chat";

const context = { id: "editor-selection:buffer-1:0:5" } as EditorSelectionContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentChatId = "chat-1";
  mocks.chats = [{ id: "chat-1", agentId: "custom" }];
  mocks.selection = {
    start: { line: 1, column: 0, offset: 13 },
    end: { line: 1, column: 12, offset: 25 },
  };
});

describe("add selection to agent chat", () => {
  it("appends the selection to the current chat and shows it", () => {
    expect(addEditorSelectionsToAgentChat([context])).toBe("agent://chat-1");
    expect(mocks.setPendingAgentLaunchRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat-1",
        agentId: "custom",
        prompt: null,
        editorSelections: [context],
        mode: "append",
      }),
    );
    expect(mocks.openNewAgentChat).not.toHaveBeenCalled();
  });

  it("opens a new chat when there is no current chat", () => {
    mocks.currentChatId = null;
    mocks.chats = [];
    addEditorSelectionsToAgentChat([context]);
    expect(mocks.openNewAgentChat).toHaveBeenCalledWith(undefined, {
      editorSelections: [context],
    });
    expect(mocks.setPendingAgentLaunchRequest).not.toHaveBeenCalled();
  });

  it("builds the context from the active selection with its file and line range", () => {
    addActiveSelectionToAgentChat();
    const request = mocks.setPendingAgentLaunchRequest.mock.calls[0][0];
    expect(request.editorSelections).toEqual([
      expect.objectContaining({
        filePath: "/project/src/app.ts",
        selectedText: "const b = 2;",
        startLine: 2,
        endLine: 2,
        languageId: "typescript",
      }),
    ]);
  });

  it("only shows the current chat when nothing is selected", () => {
    mocks.selection = undefined;
    expect(addActiveSelectionToAgentChat()).toBe("agent://chat-1");
    expect(mocks.setPendingAgentLaunchRequest).not.toHaveBeenCalled();
  });

  it("starts a new chat holding the selection", () => {
    addActiveSelectionToNewAgentChat();
    expect(mocks.openNewAgentChat).toHaveBeenCalledWith(undefined, {
      editorSelections: [expect.objectContaining({ selectedText: "const b = 2;" })],
    });
  });
});
