// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAIChatStore } from "../stores/ai-chat.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
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
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));

vi.mock("../components/input/composer-agent-selector", () => ({
  ComposerAgentSelector: ({
    onModelChange,
  }: {
    onModelChange: (model: string, provider: string) => void;
  }) => <button onClick={() => onModelChange("new-model", "openai")}>Change test model</button>,
}));

function composer(overrides: Partial<AIChatInputBarProps> = {}) {
  return (
    <AIChatInputBar
      surfaceId="composer-test"
      buffers={[]}
      allProjectFiles={[]}
      currentAgentId="codex"
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
      onSendMessage={() => ({ accepted: true })}
      onInterruptAndSend={() => ({ accepted: true })}
      onMoveQueuedMessage={vi.fn()}
      onRemoveQueuedMessage={vi.fn()}
      onStopStreaming={vi.fn()}
      {...overrides}
    />
  );
}

let root: Root;
let container: HTMLDivElement;
const onSendMessage = vi.fn(() => ({ accepted: true }));

beforeEach(async () => {
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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(composer({ onSendMessage })));
  await act(async () => {
    const input = container.querySelector('[role="textbox"]')!;
    input.textContent = "日本語";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Composer IME confirmation", () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "keeps the draft until ordinary Enter after %j",
    async (options) => {
      const input = container.querySelector('[role="textbox"]')!;
      const confirmation = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...options,
      });
      await act(async () => {
        input.dispatchEvent(confirmation);
      });
      expect(confirmation.defaultPrevented).toBe(false);
      expect(onSendMessage).not.toHaveBeenCalled();
      expect(input.textContent).toBe("日本語");
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      expect(onSendMessage).toHaveBeenCalledExactlyOnceWith("日本語", []);
      expect(input.textContent).toBe("");
    },
  );
});

describe("Composer model selection", () => {
  it("changes the current API conversation without navigating or changing global defaults", async () => {
    const onAgentChange = vi.fn();
    const setChatModel = vi
      .spyOn(useAIChatStore.getState().actions, "setChatModel")
      .mockImplementation(() => {});
    const updateSetting = vi
      .spyOn(useSettingsStore.getState().actions, "updateSetting")
      .mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        composer({
          chatId: "existing-conversation",
          currentAgentId: "custom",
          onAgentChange,
        }),
      ),
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Change test model")!
        .click();
    });
    expect(setChatModel).toHaveBeenCalledExactlyOnceWith(
      "existing-conversation",
      "openai",
      "new-model",
    );
    expect(onAgentChange).not.toHaveBeenCalled();
    expect(updateSetting).not.toHaveBeenCalled();
    expect(container.querySelector('[role="textbox"]')?.textContent).toBe("日本語");
  });
});
