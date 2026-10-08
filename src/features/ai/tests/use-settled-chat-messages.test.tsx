// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { create } from "zustand";
import type { Message } from "../types/ai-chat.types";

const store = vi.hoisted(() => ({
  current: null as unknown as {
    getState: () => { messagesByChat: Record<string, Message[]> };
    setState: (state: { messagesByChat: Record<string, Message[]> }) => void;
    subscribe: (listener: () => void) => () => void;
  },
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  get useAIChatStore() {
    return store.current;
  },
}));

const { useSettledChatMessages } = await import("../hooks/use-settled-chat-messages");

function message(id: string, content: string): Message {
  return { id, role: "assistant", content, timestamp: new Date(0) } as Message;
}

let renders = 0;
let latest: Message[] = [];
function Reader({ chatId }: { chatId: string | null }) {
  renders++;
  latest = useSettledChatMessages(chatId);
  return null;
}

let container: HTMLDivElement;
let root: Root;

describe("useSettledChatMessages", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    store.current = create(() => ({ messagesByChat: {} as Record<string, Message[]> }));
    renders = 0;
    latest = [];
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("picks up messages for a chat that just loaded at once", () => {
    act(() => root.render(<Reader chatId="chat" />));
    expect(latest).toEqual([]);

    const loaded = [message("a", "hello")];
    act(() => store.current.setState({ messagesByChat: { chat: loaded } }));

    expect(latest).toBe(loaded);
  });

  it("does not re-render per streaming frame and settles after the stream pauses", () => {
    store.current.setState({ messagesByChat: { chat: [message("a", "")] } });
    act(() => root.render(<Reader chatId="chat" />));
    const rendersBefore = renders;

    let final: Message[] = [];
    for (let frame = 1; frame <= 20; frame++) {
      final = [message("a", "x".repeat(frame))];
      act(() => {
        store.current.setState({ messagesByChat: { chat: final } });
        vi.advanceTimersByTime(16);
      });
    }
    expect(renders).toBe(rendersBefore);

    act(() => vi.advanceTimersByTime(300));
    expect(latest).toBe(final);
    expect(renders).toBe(rendersBefore + 1);
  });
});
