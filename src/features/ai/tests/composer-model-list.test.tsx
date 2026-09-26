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
  models: [{ id: "gpt-test", name: "GPT Test" }],
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
    return { availableModels: state.models, isLoadingModels: false, modelFetchError: null };
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

describe("unified composer model list", () => {
  it("offers Athas and configured provider/agent models directly in one list", async () => {
    expect(state.loadModels).not.toHaveBeenCalled();
    await open();
    expect(rows().map((row) => row.textContent)).toEqual([
      "Automaticvia Athas",
      "GPT Testvia OpenAI",
      "Defaultvia Codex",
      "Codex Testvia Codex",
    ]);
    expect(rows()[0].getAttribute("aria-checked")).toBe("true");
    expect(state.loadModels).not.toHaveBeenCalledWith("anthropic");
    await act(async () =>
      rows()
        .find((row) => row.textContent?.includes("GPT Test"))!
        .click(),
    );
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("gpt-test", "openai");
    expect(onAgentChange).not.toHaveBeenCalled();
  });
  it("searches all models and their connection names with one input", async () => {
    await open();
    await search("Codex");
    expect(rows().map((row) => row.textContent)).toEqual([
      "Defaultvia Codex",
      "Codex Testvia Codex",
    ]);
    await search("missing-model");
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain("No matching models");
    await search("Athas");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toBe("Automaticvia Athas");
  });
  it("selects the model and agent together for a Codex row", async () => {
    await open();
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
