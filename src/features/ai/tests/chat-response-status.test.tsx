// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatMessage } from "@/features/ai/components/chat/chat-message";
import { elapsedSeconds, formatElapsed } from "@/features/ai/lib/elapsed-time";
import type { Message } from "@/features/ai/types/ai-chat.types";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));

vi.mock("@/ui/thinking-orb", () => ({ ThinkingOrb: () => null }));

describe("elapsed time", () => {
  it("formats seconds and minutes", () => {
    expect(formatElapsed(8)).toBe("8s");
    expect(formatElapsed(125)).toBe("2m 05s");
    expect(elapsedSeconds(new Date(1_000), 43_500)).toBe(42);
    expect(elapsedSeconds("not a date", 1_000)).toBe(0);
  });
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const waiting = (responsePhase: Message["responsePhase"]): Message => ({
  id: "reply",
  role: "assistant",
  content: "",
  timestamp: new Date("2026-01-01T00:00:00Z"),
  isStreaming: true,
  responsePhase,
});

describe("response status", () => {
  it("counts the wait and offers Retry once the agent stalls", async () => {
    const retry = vi.fn();
    await act(async () =>
      root.render(
        <ChatMessage message={waiting("waiting")} isLastMessage onRetryStalled={retry} />,
      ),
    );
    expect(container.textContent).toContain("30s");
    expect(container.textContent).not.toContain("Retry");

    await act(async () => vi.advanceTimersByTime(2000));
    expect(container.textContent).toContain("32s");

    await act(async () =>
      root.render(
        <ChatMessage message={waiting("stalled")} isLastMessage onRetryStalled={retry} />,
      ),
    );
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Retry",
    )!;
    await act(async () => button.click());
    expect(retry).toHaveBeenCalledOnce();
  });
});
