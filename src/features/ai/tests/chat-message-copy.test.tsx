// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatMessage } from "../components/chat/chat-message";
import type { Message } from "../types/ai-chat.types";

const writeClipboardText = vi.fn(async (_text: string) => {});
vi.mock("@/utils/clipboard", () => ({
  writeClipboardText: (text: string) => writeClipboardText(text),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("../components/messages/markdown-renderer", () => ({ default: () => null }));

const RESPONSE = "Updated `src/app.ts`.\n\n- **Fixed** the loop\n\n```ts\nrun();\n```\n";

let root: Root;
let container: HTMLDivElement;

async function render(message: Message) {
  await act(async () => root.render(<ChatMessage message={message} isLastMessage />));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  writeClipboardText.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ChatMessage footer", () => {
  it("keeps one always-visible copy action that copies the response as Markdown", async () => {
    await render({ id: "reply", role: "assistant", content: RESPONSE, timestamp: new Date() });

    const footer = container.querySelector('[data-slot="message-footer"]');
    expect(footer?.getAttribute("data-visibility")).toBe("always");
    const copyButtons = container.querySelectorAll('button[aria-label^="Copy"]');
    expect(copyButtons).toHaveLength(1);
    expect(copyButtons[0]?.getAttribute("aria-label")).toBe("Copy response");

    await act(async () => (copyButtons[0] as HTMLButtonElement).click());
    expect(writeClipboardText).toHaveBeenCalledWith(RESPONSE.trim());
  });

  it("waits for the reply to finish before offering to copy it", async () => {
    await render({
      id: "reply",
      role: "assistant",
      content: RESPONSE,
      timestamp: new Date(),
      isStreaming: true,
    });

    expect(container.querySelector('button[aria-label="Copy response"]')).toBeNull();
  });

  it("reveals prompt actions on hover of the whole message row", async () => {
    await render({ id: "prompt", role: "user", content: "Hey", timestamp: new Date() });

    const footer = container.querySelector('[data-slot="message-footer"]');
    expect(footer?.getAttribute("data-visibility")).toBe("hover");
    expect(footer?.closest('[data-slot="message"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Copy prompt"]')).not.toBeNull();
  });
});
