// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAIChatStore } from "../stores/ai-chat.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import AIChatInputBar from "../components/input/chat-input-bar";
import type { AIChatInputBarProps } from "../types/ai-chat.types";
import * as terminalCommands from "../services/chat-terminal-command";
import { useProjectStore } from "@/features/window/stores/project.store";

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

describe("Composer terminal commands", () => {
  const originalSettings = useSettingsStore.getState().settings;
  const originalProjectPath = useProjectStore.getState().rootFolderPath;
  const originalProviderKeys = useAIChatStore.getState().providerApiKeys;
  let openTerminal: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    openTerminal = vi
      .spyOn(terminalCommands, "runChatTerminalCommand")
      .mockReturnValue("terminal-test");
    await act(async () => {
      useProjectStore.getState().actions.setRootFolderPath("/workspace/athas");
      useSettingsStore.setState({
        settings: {
          ...originalSettings,
          coreFeatures: { ...originalSettings.coreFeatures, terminal: true },
        },
      });
    });
  });

  afterEach(() => {
    useSettingsStore.setState({ settings: originalSettings });
    useProjectStore.getState().actions.setRootFolderPath(originalProjectPath);
    useAIChatStore.setState({ providerApiKeys: originalProviderKeys });
  });

  async function type(text: string) {
    const input = container.querySelector('[role="textbox"]')!;
    await act(async () => {
      input.textContent = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  async function key(key: string, options: KeyboardEventInit = {}) {
    await act(async () => {
      container
        .querySelector('[role="textbox"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
        );
    });
  }

  it("submits an inline command without sending an AI message", async () => {
    const input = await type("!git status");
    expect(input.getAttribute("aria-label")).toBe("Terminal command");
    expect(container.textContent).toContain("Output appears in chat");
    await key("Enter");
    expect(openTerminal).toHaveBeenCalledExactlyOnceWith({
      command: "git status",
      chatId: undefined,
      agentId: "codex",
      workingDirectory: "/workspace/athas",
    });
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(input.textContent).toBe("");
    expect(input.getAttribute("aria-label")).toBe("Message input");
  });

  it.each(["!", "!   "])("does not execute an empty command %j", async (text) => {
    await type(text);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Run command"]')?.disabled).toBe(
      true,
    );
    await key("Enter");
    expect(openTerminal).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it.each([{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }])(
    "does not run for non-submission Enter %j",
    async (options) => {
      const input = await type("!git status");
      await key("Enter", options);
      expect(openTerminal).not.toHaveBeenCalled();
      expect(input.textContent).toBe("!git status");
    },
  );

  it("returns to chat with Escape without losing the command", async () => {
    const input = await type("!git status");
    await key("Escape");
    expect(input.textContent).toBe("git status");
    expect(input.getAttribute("aria-label")).toBe("Message input");
    expect(openTerminal).not.toHaveBeenCalled();
    await key("Enter");
    expect(onSendMessage).toHaveBeenCalledExactlyOnceWith("git status", []);
  });

  it("leaves exclamation marks inside ordinary messages alone", async () => {
    await type("Please explain !git status");
    await key("Enter");
    expect(openTerminal).not.toHaveBeenCalled();
    expect(onSendMessage).toHaveBeenCalledExactlyOnceWith("Please explain !git status", []);
  });

  it("runs from the button during streaming without interrupting or queuing a message", async () => {
    const onStopStreaming = vi.fn();
    const onInterruptAndSend = vi.fn(() => ({ accepted: true }));
    await act(async () =>
      root.render(
        composer({
          onSendMessage,
          onStopStreaming,
          onInterruptAndSend,
          isTyping: true,
          streamingMessageId: "response",
        }),
      ),
    );
    await type('!printf "%s" "hello world"');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Run command"]')!.click(),
    );
    expect(openTerminal).toHaveBeenCalledExactlyOnceWith({
      command: 'printf "%s" "hello world"',
      chatId: undefined,
      agentId: "codex",
      workingDirectory: "/workspace/athas",
    });
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(onStopStreaming).not.toHaveBeenCalled();
    expect(onInterruptAndSend).not.toHaveBeenCalled();
  });

  it("works without AI provider credentials", async () => {
    await act(async () => {
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, aiProviderId: "openai" },
      });
      useAIChatStore.setState({ providerApiKeys: new Map() });
      root.render(composer({ currentAgentId: "custom", onSendMessage }));
    });
    const input = await type("!git status");
    expect(input.getAttribute("contenteditable")).toBe("true");
    await key("Enter");
    expect(openTerminal).toHaveBeenCalledOnce();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("respects the terminal feature setting", async () => {
    await act(async () =>
      useSettingsStore.setState({
        settings: {
          ...originalSettings,
          coreFeatures: { ...originalSettings.coreFeatures, terminal: false },
        },
      }),
    );
    await type("!git status");
    await key("Enter");
    expect(openTerminal).not.toHaveBeenCalled();
    expect(onSendMessage).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enable Terminal in Settings");
  });

  it("keeps the draft if command submission fails", async () => {
    openTerminal.mockImplementation(() => {
      throw new Error("Terminal unavailable");
    });
    const input = await type("!git status");
    await key("Enter");
    expect(input.textContent).toBe("!git status");
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("passes the workspace to the command runner for validation", async () => {
    await act(async () =>
      useProjectStore.getState().actions.setRootFolderPath("remote://server/home/project"),
    );
    await type("!git status");
    await key("Enter");
    expect(openTerminal).toHaveBeenCalledExactlyOnceWith({
      command: "git status",
      chatId: undefined,
      agentId: "codex",
      workingDirectory: "remote://server/home/project",
    });
  });
});
