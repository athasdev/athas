// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

import { AgentMessageQueue } from "../components/input/agent-message-queue";
import { continuesAgentQueue, getAgentRunEnding } from "../lib/agent-message-queue";
import { useAIChatStore } from "../stores/ai-chat.store";
import type { QueuedAgentMessage } from "../types/ai-chat.types";

describe("agent message queue policy", () => {
  it("moves on only after a turn that ended normally or was interrupted to send now", () => {
    expect(continuesAgentQueue("completed")).toBe(true);
    expect(continuesAgentQueue("interrupted")).toBe(true);
    expect(continuesAgentQueue("stopped")).toBe(false);
    expect(continuesAgentQueue("refused")).toBe(false);
    expect(continuesAgentQueue("failed")).toBe(false);
  });

  it("classifies how a turn ended from cancellation and its stop notice", () => {
    expect(getAgentRunEnding(false)).toBe("completed");
    expect(getAgentRunEnding(false, "max_tokens")).toBe("completed");
    expect(getAgentRunEnding(false, "max_turn_requests")).toBe("completed");
    expect(getAgentRunEnding(false, "prompt_refused")).toBe("refused");
    expect(getAgentRunEnding(false, "refused")).toBe("refused");
    expect(getAgentRunEnding(true)).toBe("stopped");
  });
});

describe("agent message queue store", () => {
  beforeEach(() => {
    useAIChatStore.setState({ agentMessageQueues: {} });
  });

  it("edits a queued message's text and keeps its images", () => {
    const actions = useAIChatStore.getState().actions;
    const images = [{ mediaType: "image/png", data: "YWJj" }];
    actions.enqueueAgentMessage("chat", "first", images);
    actions.enqueueAgentMessage("chat", "second");
    actions.updateQueuedAgentMessage("chat", 0, "first, reworded");
    actions.updateQueuedAgentMessage("chat", 5, "ignored");
    expect(useAIChatStore.getState().agentMessageQueues.chat).toEqual([
      { content: "first, reworded", images },
      { content: "second" },
    ]);
  });

  it("puts a message sent now at the front so it runs next", () => {
    const actions = useAIChatStore.getState().actions;
    actions.enqueueAgentMessage("chat", "a");
    actions.enqueueAgentMessage("chat", "b");
    actions.enqueueAgentMessage("chat", "c");
    actions.moveQueuedAgentMessage("chat", 2, 0);
    expect(actions.dequeueAgentMessage("chat")).toEqual({ content: "c" });
  });
});

describe("AgentMessageQueue", () => {
  let container: HTMLDivElement;
  let root: Root;
  const handlers = {
    onUpdate: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    onSendNow: vi.fn(),
  };

  function render(messages: QueuedAgentMessage[]) {
    return act(async () => root.render(<AgentMessageQueue messages={messages} {...handlers} />));
  }

  function button(label: string, index = 0) {
    return container.querySelectorAll<HTMLButtonElement>(`[aria-label="${label}"]`)[index]!;
  }

  function editDraft(value: string) {
    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Queued message text"]',
    )!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setValue.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    for (const handler of Object.values(handlers)) handler.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders nothing without queued messages", async () => {
    await render([]);
    expect(container.innerHTML).toBe("");
  });

  it("lists each message in send order and notes attached images", async () => {
    await render([
      { content: "run the tests" },
      { content: "", images: [{ mediaType: "image/png", data: "YWJj" }] },
    ]);
    expect(container.textContent).toContain("2 queued messages");
    expect(container.textContent).toContain("Sends next");
    expect(container.textContent).toContain("run the tests");
    expect(container.textContent).toContain("Sends #2");
    expect(container.textContent).toContain("1 image attached");
    expect(button("Move earlier", 0).disabled).toBe(true);
    expect(button("Move later", 1).disabled).toBe(true);
  });

  it("sends, reorders and removes a message by its position", async () => {
    await render([{ content: "a" }, { content: "b" }]);
    await act(async () => button("Send now", 1).click());
    await act(async () => button("Move earlier", 1).click());
    await act(async () => button("Remove queued message", 0).click());
    expect(handlers.onSendNow).toHaveBeenCalledExactlyOnceWith(1);
    expect(handlers.onMove).toHaveBeenCalledExactlyOnceWith(1, 0);
    expect(handlers.onRemove).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("edits a message in place without touching the composer", async () => {
    await render([{ content: "a" }, { content: "b" }]);
    await act(async () => button("Edit queued message", 1).click());
    await act(async () => editDraft("b, but shorter"));
    await act(async () => button("Save queued message").click());
    expect(handlers.onUpdate).toHaveBeenCalledExactlyOnceWith(1, "b, but shorter");
    expect(container.querySelector('[aria-label="Queued message text"]')).toBeNull();
  });

  it("saves the edit to the same message after the queue moves on", async () => {
    const first = { content: "a" };
    const second = { content: "b" };
    await render([first, second]);
    await act(async () => button("Edit queued message", 1).click());
    await act(async () => editDraft("b2"));
    await render([second]);
    await act(async () => button("Save queued message").click());
    expect(handlers.onUpdate).toHaveBeenCalledExactlyOnceWith(0, "b2");
  });

  it("discards a text-only message whose text is cleared", async () => {
    await render([{ content: "a" }]);
    await act(async () => button("Edit queued message").click());
    await act(async () => editDraft("  "));
    await act(async () => button("Save queued message").click());
    expect(handlers.onRemove).toHaveBeenCalledExactlyOnceWith(0);
    expect(handlers.onUpdate).not.toHaveBeenCalled();
  });
});
