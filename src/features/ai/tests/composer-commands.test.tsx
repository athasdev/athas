// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAIChatStore } from "../stores/ai-chat.store";
import AIChatInputBar from "../components/input/chat-input-bar";
import type { AIChatInputBarProps } from "../types/ai-chat.types";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("../hooks/use-voice-input", () => ({
  useVoiceInput: () => ({
    isListening: false,
    interimTranscript: "",
    isSupported: false,
    isMacDevBlocked: false,
    toggle: vi.fn(),
  }),
}));
vi.mock("../hooks/use-composer-context-budget", () => ({
  useComposerContextBudget: () => null,
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
vi.mock("../components/input/composer-agent-selector", () => ({
  ComposerAgentSelector: () => null,
}));

const onSendMessage = vi.fn((_message: string) => ({ accepted: true }));
const onInterruptAndSend = vi.fn((_message: string) => ({ accepted: true }));

function composer(overrides: Partial<AIChatInputBarProps> = {}) {
  return (
    <AIChatInputBar
      surfaceId="composer-commands-test"
      buffers={[]}
      allProjectFiles={[]}
      currentAgentId="custom"
      isTyping={false}
      streamingMessageId={null}
      queuedMessages={[]}
      selectedBufferIds={new Set()}
      selectedFilesPaths={new Set()}
      selectedEditorContexts={[]}
      onToggleBufferSelection={vi.fn()}
      onToggleFileSelection={vi.fn()}
      onSetSelectedBufferIds={vi.fn()}
      onSetSelectedFilesPaths={vi.fn()}
      onRemoveEditorContext={vi.fn()}
      onSendMessage={onSendMessage}
      onInterruptAndSend={onInterruptAndSend}
      onMoveQueuedMessage={vi.fn()}
      onUpdateQueuedMessage={vi.fn()}
      onRemoveQueuedMessage={vi.fn()}
      onSendQueuedMessageNow={vi.fn()}
      onStopStreaming={vi.fn()}
      {...overrides}
    />
  );
}

let root: Root;
let container: HTMLDivElement;

async function render(overrides: Partial<AIChatInputBarProps> = {}) {
  await act(async () => root.render(composer(overrides)));
}

function input() {
  return container.querySelector<HTMLElement>('[role="textbox"]')!;
}

async function type(text: string) {
  await act(async () => {
    input().textContent = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  await act(async () => {
    input().dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 0),
  );
  useAIChatStore.getState().actions.setMode("chat");
  useAIChatStore.setState({ hasApiKey: true, providerApiKeys: new Map([["athas", true]]) });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Composer modes and commands", () => {
  it("steps through Agent, Ask and Plan with Shift+Tab", async () => {
    await render();
    const event = await press("Tab", { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(useAIChatStore.getState().mode).toBe("ask");
    await press("Tab", { shiftKey: true });
    expect(useAIChatStore.getState().mode).toBe("plan");
    expect(container.querySelector('[aria-label="Mode: Plan"]')).not.toBeNull();
  });

  it("switches mode from a leading /plan and sends the rest of the message", async () => {
    await render();
    await type("/plan add dark mode");
    await press("Enter");
    expect(useAIChatStore.getState().mode).toBe("plan");
    expect(onSendMessage).toHaveBeenCalledWith("add dark mode", []);
  });

  it("interrupts and sends with Cmd or Ctrl+Enter while the agent responds", async () => {
    await render({ isTyping: true, streamingMessageId: "response" });
    await type("stop and do this instead");
    await press("Enter", { metaKey: true });
    expect(onInterruptAndSend).toHaveBeenCalledWith("stop and do this instead", []);
    expect(onSendMessage).not.toHaveBeenCalled();

    await type("queue this");
    await press("Enter");
    expect(onSendMessage).toHaveBeenCalledWith("queue this", []);
  });
});
