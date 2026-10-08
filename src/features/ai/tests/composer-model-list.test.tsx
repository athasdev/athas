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
    options: [
      { id: "codex", name: "Codex", isInstalled: true, isCurrent: false },
      { id: "claude-acp", name: "Claude Agent", isInstalled: false, isCurrent: false },
      { id: "gemini", name: "Gemini CLI", isInstalled: true, isCurrent: false },
    ],
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
vi.mock("@/features/layout/stores/ui-state.store", () => ({
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
const sections = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-label"]')].map(
    (label) => label.textContent,
  );
const rowsIn = (section: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-label"]')]
    .find((label) => label.textContent === section)!
    .closest('[role="group"]')!
    .querySelectorAll<HTMLElement>('[role="menuitemradio"]');
const names = (items: Iterable<HTMLElement>) => [...items].map((row) => row.textContent);

describe("composer model selector", () => {
  it("lists every connection as a headed section in one flat list", async () => {
    await open();
    expect(document.querySelector('[data-slot="dropdown-menu-sub-trigger"]')).toBeNull();
    expect(sections()).toEqual(["Recommended", "Athas", "OpenAI", "Codex", "Agents"]);
    expect(names(rowsIn("Recommended"))).toEqual(["Automatic", "Claude Sonnet 5"]);
    expect(names(rowsIn("Athas"))).toEqual([
      "Automatic",
      "Kimi K2.6",
      "Claude Sonnet 5",
      "DeepSeek V4 Pro",
    ]);
    expect(names(rowsIn("Codex"))).toEqual(["Default", "Codex Test"]);
    const sonnet = rowsIn("Athas")[2];
    expect(sonnet.getAttribute("title")).toContain("Anthropic");
    expect(sonnet.getAttribute("title")).toContain("billed at list price +10%");
    expect(rowsIn("Athas")[0].getAttribute("aria-checked")).toBe("true");
    await act(async () => rowsIn("Athas")[1].click());
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("moonshotai/kimi-k2.6", "athas");
    expect(state.loadModels).not.toHaveBeenCalledWith("anthropic");
  });
  it("selects a configured provider model from its section", async () => {
    await open();
    await act(async () => rowsIn("OpenAI")[0].click());
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("gpt-test", "openai");
    expect(onAgentChange).not.toHaveBeenCalled();
  });
  it("filters every section at once and keeps the headers of matches", async () => {
    await open();
    await search("Codex");
    expect(sections()).toEqual(["Codex"]);
    expect(names(rows())).toEqual(["Default", "Codex Test"]);
    await search("missing-model");
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain("No matching models");
    await search("kimi");
    expect(sections()).toEqual(["Athas"]);
    expect(names(rows())).toEqual(["Kimi K2.6"]);
    await search("anthropic");
    expect(names(rows())).toEqual(["Claude Sonnet 5"]);
  });
  it("lists installed agents and switches to one from its row", async () => {
    await open();
    expect(names(rowsIn("Agents"))).toEqual(["Gemini CLI"]);
    await act(async () => rowsIn("Agents")[0].click());
    expect(onAgentChange).toHaveBeenCalledExactlyOnceWith("gemini");
  });
  it("selects the model and agent together for a Codex row", async () => {
    await open();
    await act(async () => rowsIn("Codex")[1].click());
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
