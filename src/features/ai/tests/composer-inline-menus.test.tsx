// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { emitAppEvent } from "@/utils/app-events";
import AIChatInputBar from "../components/input/chat-input-bar";
import { useAIChatStore } from "../stores/ai-chat.store";
import type { AIChatInputBarProps } from "../types/ai-chat.types";

const toasts = vi.hoisted(() => [] as Array<{ message: string; type: string }>);

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
vi.mock("../components/input/composer-agent-selector", () => ({
  ComposerAgentSelector: () => null,
}));
vi.mock("@/utils/toast", () => ({
  useToast: () => ({
    showToast: (toast: { message: string; type: string }) => {
      toasts.push(toast);
      return "toast";
    },
  }),
}));

enableMapSet();

const props = {
  onSendMessage: vi.fn<AIChatInputBarProps["onSendMessage"]>(() => ({ accepted: true })),
  onInterruptAndSend: vi.fn<AIChatInputBarProps["onInterruptAndSend"]>(() => ({ accepted: true })),
  onStopStreaming: vi.fn(),
  onToggleFileSelection: vi.fn(),
  onToggleBufferSelection: vi.fn(),
  onSetSelectedFilesPaths: vi.fn(),
  onSetSelectedBufferIds: vi.fn(),
  onRemoveEditorContext: vi.fn(),
};

const projectFiles = [
  { name: "index.ts", path: "/repo/src/index.ts", isDir: false },
  { name: "readme.md", path: "/repo/readme.md", isDir: false },
  { name: "src", path: "/repo/src", isDir: true },
];

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
let surface = 0;

async function render(overrides: Partial<AIChatInputBarProps> = {}) {
  await act(async () =>
    root.render(
      <AIChatInputBar
        surfaceId={`inline-menus-${surface}`}
        buffers={[]}
        allProjectFiles={projectFiles}
        currentAgentId="custom"
        isTyping={false}
        streamingMessageId={null}
        queuedMessages={[]}
        selectedBufferIds={new Set()}
        selectedFilesPaths={new Set()}
        selectedEditorContexts={[]}
        onMoveQueuedMessage={vi.fn()}
        onUpdateQueuedMessage={vi.fn()}
        onRemoveQueuedMessage={vi.fn()}
        onSendQueuedMessageNow={vi.fn()}
        {...props}
        {...overrides}
      />,
    ),
  );
}

const input = () => container.querySelector<HTMLElement>('[aria-label="Message input"]')!;

function placeCaret(node: Node, offset?: number) {
  const range = document.createRange();
  if (offset === undefined) {
    range.selectNodeContents(node);
    range.collapse(false);
  } else {
    range.setStart(node, offset);
    range.collapse(true);
  }
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

async function type(text: string) {
  await act(async () => {
    input().focus();
    input().textContent = text;
    placeCaret(input());
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const slashOptions = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[aria-label="Slash command suggestions"] [role="option"]',
    ),
  ].map((option) => ({
    name: option.textContent ?? "",
    selected: option.getAttribute("aria-selected") === "true",
  }));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  toasts.length = 0;
  surface += 1;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.getAnimations = () => [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
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
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("composer file mentions", () => {
  it("turns an @ search into a file chip that is sent as a mention", async () => {
    await render();
    await type("look at @ind");
    await wait(400);

    const suggestions = document.querySelector('[aria-label="File suggestions"]');
    expect(suggestions?.textContent).toContain("index.ts");
    expect(suggestions?.textContent).not.toContain("readme.md");

    await press("ArrowDown");
    await press("ArrowUp");
    await press("Enter");
    const chip = input().querySelector("[data-mention]")!;
    expect(chip.textContent).toBe("index.ts");
    expect(chip.getAttribute("title")).toBe("/repo/src/index.ts");
    expect(document.querySelector('[aria-label="File suggestions"]')).toBeNull();

    await press("Enter");
    expect(props.onSendMessage).toHaveBeenCalledTimes(1);
    expect(props.onSendMessage.mock.calls[0][0]).toMatch(/^look at @\[index\.ts\]\(.+\) $/);
    expect(input().textContent).toBe("");
  });

  it("closes the suggestions with Escape and removes a chip with Backspace", async () => {
    await render();
    await type("@read");
    await wait(400);
    await press("Escape");
    expect(document.querySelector('[aria-label="File suggestions"]')).toBeNull();

    await type("@readm");
    await wait(400);
    await press("Tab");
    const chip = input().querySelector("[data-mention]")!;
    expect(chip).not.toBeNull();

    await act(async () => placeCaret(chip.nextSibling!, 0));
    await press("Backspace");
    expect(input().querySelector("[data-mention]")).toBeNull();
    expect(input().textContent?.trim()).toBe("");
  });

  it("puts the caret after a chip when the chip is clicked", async () => {
    await render();
    await type("@index");
    await wait(400);
    await press("Enter");
    const chip = input().querySelector("[data-mention]")!;
    await act(async () => placeCaret(input(), 0));
    await act(async () => {
      fireEvent.mouseDown(chip);
    });
    const range = window.getSelection()!.getRangeAt(0);
    expect(range.startContainer).toBe(input());
    expect(range.startOffset).toBe([...input().childNodes].indexOf(chip) + 1);
  });
});

describe("composer slash commands", () => {
  it("lists commands, moves the selection and filters by name", async () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("custom");
    await render({ chatId });
    await type("/");
    const names = slashOptions().map((option) => option.name);
    expect(names.some((name) => name.includes("compact"))).toBe(true);
    expect(names.some((name) => name.includes("clear"))).toBe(true);
    expect(slashOptions()[0].selected).toBe(true);

    await press("ArrowDown");
    expect(slashOptions()[1].selected).toBe(true);
    await press("ArrowUp");
    expect(slashOptions()[0].selected).toBe(true);

    await type("/rev");
    expect(slashOptions()).toHaveLength(1);
    expect(slashOptions()[0].name).toContain("review");

    await type("/zzz");
    expect(document.body.textContent).toContain("No matching slash commands");

    await press("Escape");
    expect(document.querySelector('[aria-label="Slash command suggestions"]')).toBeNull();

    await type("/c");
    await type("hello");
    expect(document.querySelector('[aria-label="Slash command suggestions"]')).toBeNull();
  });

  it("explains when there is nothing to compact or review", async () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("custom");
    await render({ chatId });

    await type("/compact");
    await press("Enter");
    await wait(0);
    expect(last(toasts)?.message).toBe("Nothing to compact yet.");
    expect(input().textContent).toBe("");

    await type("/review");
    await press("Tab");
    expect(last(toasts)?.message).toBe("No agent changes to review in this chat.");
    expect(props.onSendMessage).not.toHaveBeenCalled();
  });

  it("will not clear or compact while a response is still streaming", async () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("custom");
    await render({ chatId, isTyping: true, streamingMessageId: "streaming" });
    await type("/clear");
    await press("Enter");
    expect(last(toasts)?.message).toBe("Wait for the current response to finish.");
  });

  it("switches mode from the menu and reports the new mode", async () => {
    await render();
    await type("/ask");
    await press("Enter");
    expect(useAIChatStore.getState().mode).toBe("ask");
    expect(last(toasts)?.message).toBe("Mode: Ask");
  });

  it("inserts a skill's instructions when its command is chosen", async () => {
    const skills = useSettingsStore.getState().settings.aiSkills;
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        aiSkills: [
          {
            id: "notes",
            title: "Release notes",
            description: "Draft release notes",
            content: "Write release notes for the last tag.",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ] as never,
      },
    }));
    await render();
    await type("/release");
    await act(async () =>
      document
        .querySelector<HTMLElement>('[aria-label="Slash command suggestions"] [role="option"]')!
        .click(),
    );
    expect(input().textContent).toContain("Write release notes for the last tag.");

    useSettingsStore.setState((state) => ({ settings: { ...state.settings, aiSkills: skills } }));
  });

  it("keeps an agent's own command as a chip in the prompt", async () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("claude-code");
    useAIChatStore.setState((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, acpSessionId: "session-1" } : chat,
      ),
      acpSessions: {
        ...state.acpSessions,
        "session-1": {
          slashCommands: [{ name: "web", description: "Search the web" }],
          modeState: { currentModeId: null, availableModes: [] },
          configOptions: [],
          usage: null,
        },
      },
    }));
    await render({ chatId, currentAgentId: "claude-code" });
    await type("/we");
    await press("Enter");
    const chip = input().querySelector("[data-slash-command]")!;
    expect(chip.textContent).toBe("/web");
    expect(chip.getAttribute("title")).toBe("Search the web");

    await act(async () => {
      input().append(document.createTextNode("latest bun release"));
      placeCaret(input());
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press("Enter");
    expect(props.onSendMessage).toHaveBeenCalledWith("/web latest bun release", []);
  });
});

describe("composer paste, skills and drops", () => {
  it("pastes plain text at the caret", async () => {
    await render();
    await type("before ");
    await act(async () => {
      fireEvent.paste(input(), {
        clipboardData: { items: [], getData: () => "pasted text" },
      });
    });
    expect(input().textContent).toBe("before pasted text");
    await press("Enter");
    expect(props.onSendMessage).toHaveBeenCalledWith("before pasted text", []);
  });

  it("attaches a pasted image and sends it without text", async () => {
    await render();
    const image = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(input(), {
        clipboardData: {
          items: [{ type: "image/png", getAsFile: () => image }],
          getData: () => "",
        },
      });
    });
    await wait(20);
    expect(within(container).getByRole("list", { name: "Attached context" }).textContent).toMatch(
      /1\s*image/i,
    );

    await act(async () => within(container).getByRole("button", { name: "Send message" }).click());
    const [message, images] = props.onSendMessage.mock.calls[0];
    expect(message).toBe("");
    expect(images).toHaveLength(1);
    expect(within(container).queryByRole("list", { name: "Attached context" })).toBeNull();
  });

  it("inserts a skill picked elsewhere into this composer only", async () => {
    await render();
    await act(async () =>
      emitAppEvent("ai:insert-skill", {
        surfaceId: "another-surface",
        skill: { content: "Ignore me" },
      } as never),
    );
    expect(input().textContent).toBe("");

    await type("Context");
    await act(async () =>
      emitAppEvent("ai:insert-skill", {
        surfaceId: `inline-menus-${surface}`,
        skill: { content: "Run the tests first." },
      } as never),
    );
    expect(input().textContent).toBe("Context\n\nRun the tests first. ");
  });

  it("highlights the drop target while files are dragged over it", async () => {
    await render();
    const composer = container.querySelector<HTMLElement>('[data-ai-element="prompt-input"]')!;
    await act(async () => {
      fireEvent.dragOver(composer, { dataTransfer: { types: ["Files"] } });
    });
    expect(within(container).getByText("Drop to add as context")).toBeTruthy();
    await act(async () => {
      fireEvent.dragLeave(composer, { relatedTarget: null });
    });
    expect(within(container).queryByText("Drop to add as context")).toBeNull();

    await act(async () => {
      fireEvent.dragOver(composer, { dataTransfer: { types: ["text/plain"] } });
    });
    expect(within(container).queryByText("Drop to add as context")).toBeNull();
  });

  it("adds a file dropped from the sidebar to the context", async () => {
    await render({ surfaceId: "activity-sidebar" });
    await act(async () =>
      emitAppEvent("sidebar:resource-drop-on-ai", {
        resource: { type: "file", path: "/repo/readme.md", isDir: false },
      } as never),
    );
    expect(props.onSetSelectedFilesPaths).toHaveBeenCalledWith(new Set(["/repo/readme.md"]));
  });

  it("removes attached files from the context", async () => {
    await render({ selectedFilesPaths: new Set(["/repo/readme.md"]) });
    await act(async () =>
      within(container)
        .getByRole("button", { name: /^Review / })
        .click(),
    );
    await act(async () =>
      within(document.body).getByRole("button", { name: "Remove readme.md from context" }).click(),
    );
    expect(props.onToggleFileSelection).toHaveBeenCalledWith("/repo/readme.md");
  });

  it("restores a prompt only into an empty composer", async () => {
    await render({ restoredPrompt: { content: "Try again please", images: [] } as never });
    expect(input().textContent).toBe("Try again please");

    await type("my own words");
    await render({ restoredPrompt: { content: "Other prompt", images: [] } as never });
    expect(input().textContent).toBe("my own words");
  });
});

describe("composer while the agent responds", () => {
  it("queues, interrupts or stops from the toolbar", async () => {
    await render({ isTyping: true, streamingMessageId: "response" });
    expect(within(container).queryByRole("button", { name: "Interrupt and send now" })).toBeNull();
    await act(async () =>
      within(container).getByRole("button", { name: "Stop generation" }).click(),
    );
    expect(props.onStopStreaming).toHaveBeenCalledTimes(1);

    await type("next step");
    await act(async () =>
      within(container).getByRole("button", { name: "Send after current response" }).click(),
    );
    expect(props.onSendMessage).toHaveBeenCalledWith("next step", []);

    await type("do this now");
    await act(async () =>
      within(container).getByRole("button", { name: "Interrupt and send now" }).click(),
    );
    expect(props.onInterruptAndSend).toHaveBeenCalledWith("do this now", []);
    expect(input().textContent).toBe("");
  });

  it("keeps the draft when the message is not accepted", async () => {
    props.onSendMessage.mockReturnValueOnce({ accepted: false });
    await render();
    await type("hold on");
    await press("Enter");
    expect(input().textContent).toBe("hold on");
  });
});
