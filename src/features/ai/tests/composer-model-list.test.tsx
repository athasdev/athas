// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ComposerAgentSelector } from "../components/input/composer-agent-selector";

const state = vi.hoisted(() => ({
  keys: new Map([["openai", true]]),
  providers: [
    { id: "athas", name: "Athas", models: [] },
    { id: "openai", name: "OpenAI", models: [] },
    { id: "anthropic", name: "Anthropic", models: [] },
  ],
  models: {
    athas: [
      { id: "auto", name: "Automatic" },
      { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6", contextWindow: 262144 },
      { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", input: 3, output: 15 },
      { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", input: 0.435, output: 0.87 },
    ],
    openai: [{ id: "gpt-test", name: "GPT Test" }],
  } as Record<
    string,
    { id: string; name: string; contextWindow?: number; input?: number; output?: number }[]
  >,
  codexModels: [
    {
      id: "codex-test",
      name: "Codex Test",
      reasoningEfforts: [{ value: "medium", label: "Medium" }],
      defaultReasoningEffort: "medium",
    },
  ],
  settings: { model: "codex-test" },
  update: vi.fn(),
  configure: vi.fn(),
  loadModels: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("../hooks/use-available-providers", () => ({
  useAvailableProviders: () => state.providers,
}));
vi.mock("../hooks/use-agent-options", () => ({
  useAgentOptions: () => ({
    options: [{ id: "codex", name: "Codex", isInstalled: true, isCurrent: false }],
    isLoading: false,
    loadError: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("../hooks/use-ai-model-options", () => ({
  useAIModelOptions: (id: string) => {
    state.loadModels(id);
    return {
      availableModels: state.models[id] ?? [],
      isLoadingModels: false,
      modelFetchError: null,
    };
  },
}));
vi.mock("../integrations/codex/use-codex-models", () => ({
  useCodexModels: () => ({ models: state.codexModels, loading: false, error: null }),
}));
vi.mock("../integrations/codex/use-codex-settings", () => ({
  useCodexSettings: () => ({ settings: state.settings, update: state.update }),
}));
vi.mock("../stores/ai-chat.store", () => ({
  useAIChatStore: (select: (value: unknown) => unknown) =>
    select({ providerApiKeys: state.keys, dynamicModels: {} }),
}));
vi.mock("@/features/window/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ openSettings: state.configure }) },
}));
vi.mock("@/features/keymaps/hooks/use-command-shortcut", () => ({
  useCommandShortcut: () => undefined,
}));
let root: Root;
let container: HTMLDivElement;
const onModelChange = vi.fn();
const onAgentChange = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  Element.prototype.getAnimations = () => [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ComposerAgentSelector
        cwd="/repo"
        currentAgentId="custom"
        providerId="athas"
        modelId="auto"
        sessionConfigOptions={[]}
        onModelChange={onModelChange}
        onAgentChange={onAgentChange}
        onSessionConfigChange={vi.fn()}
      />,
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function open() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Change model"]')!.click(),
  );
}
async function search(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Select a model…"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
const connections = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')].map(
    (trigger) => trigger.textContent,
  );
async function openConnection(name: string) {
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')]
      .find((trigger) => trigger.textContent?.startsWith(name))!
      .click(),
  );
}

describe("composer model selector", () => {
  it("groups models under their connection and marks the current choice", async () => {
    await open();
    expect(connections()).toEqual(["AthasAutomatic", "OpenAI", "Codex"]);
    expect(rows()).toHaveLength(0);
    await openConnection("Athas");
    expect(rows().map((row) => row.textContent)).toEqual([
      "AutomaticBest per request",
      "Kimi K2.6Moonshot",
      "Claude Sonnet 5$3 / $15",
      "DeepSeek V4 Pro$0.435 / $0.87",
    ]);
    expect(rows()[2].getAttribute("title")).toContain("billed at list price +10%");
    expect(rows()[0].getAttribute("aria-checked")).toBe("true");
    await act(async () => rows()[1].click());
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("moonshotai/kimi-k2.6", "athas");
    expect(state.loadModels).not.toHaveBeenCalledWith("anthropic");
  });
  it("selects a configured provider model from its submenu", async () => {
    await open();
    await openConnection("OpenAI");
    await act(async () =>
      rows()
        .find((row) => row.textContent?.includes("GPT Test"))!
        .click(),
    );
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("gpt-test", "openai");
    expect(onAgentChange).not.toHaveBeenCalled();
  });
  it("flattens every connection into one searchable list", async () => {
    await open();
    await search("Codex");
    expect(connections()).toEqual([]);
    expect(rows().map((row) => row.textContent)).toEqual([
      "Defaultvia Codex",
      "Codex Testvia Codex",
    ]);
    await search("missing-model");
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain("No matching models");
    await search("kimi");
    expect(rows().map((row) => row.textContent)).toEqual(["Kimi K2.6via Athas"]);
    await search("anthropic");
    expect(rows().map((row) => row.textContent)).toEqual(["Claude Sonnet 5via Athas"]);
  });
  it("selects the model and agent together for a Codex row", async () => {
    await open();
    await search("Codex Test");
    await act(async () =>
      rows()
        .find((row) => row.textContent === "Codex Testvia Codex")!
        .click(),
    );
    expect(state.update).toHaveBeenCalledOnce();
    expect(onAgentChange).toHaveBeenCalledExactlyOnceWith("codex");
    expect(onModelChange).not.toHaveBeenCalled();
  });
  it("opens the existing AI configuration from the list footer", async () => {
    await open();
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((row) => row.textContent === "Configure models…")!
        .click(),
    );
    expect(state.configure).toHaveBeenCalledExactlyOnceWith("ai");
  });
});
