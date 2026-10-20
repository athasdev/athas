// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ComposerAgentSelector } from "../components/input/composer-agent-selector";

const state = vi.hoisted(() => ({
  keys: new Map([["openai", true]]),
  providers: [
    { id: "athas", name: "Athas", models: [] },
    { id: "openai", name: "OpenAI", models: [{ id: "gpt-test", name: "GPT Test" }] },
    { id: "anthropic", name: "Anthropic", models: [] },
  ],
  models: {
    athas: [
      { id: "auto", name: "Automatic" },
      { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6", contextWindow: 262144 },
      { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", input: 3, output: 15 },
      { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", input: 0.435, output: 0.87 },
      { id: "qwen/qwen-4", name: "Qwen 4" },
      { id: "mistral/mistral-large", name: "Mistral Large" },
      { id: "x-ai/grok-5", name: "Grok 5" },
      { id: "minimax/minimax-m3", name: "MiniMax M3" },
      { id: "zai/glm-5", name: "GLM 5" },
    ],
    openai: [
      { id: "gpt-test", name: "GPT Test" },
      { id: "gpt-mini", name: "GPT Mini" },
    ],
  } as Record<
    string,
    { id: string; name: string; contextWindow?: number; input?: number; output?: number }[]
  >,
  codexModels: [
    {
      id: "codex-test",
      name: "Codex Test",
      isDefault: true,
      reasoningEfforts: [
        { value: "low", label: "Fast answers" },
        { value: "medium", label: "Balanced" },
      ],
      defaultReasoningEffort: "medium",
    },
  ],
  settings: { model: "codex-test", effort: "" },
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

const effortOption = {
  id: "effort",
  name: "Effort",
  category: "thought_level",
  kind: {
    type: "select" as const,
    currentValue: "high",
    options: [
      { id: "low", name: "Low" },
      { id: "high", name: "High" },
    ],
  },
};

let root: Root;
let container: HTMLDivElement;
const onModelChange = vi.fn();
const onAgentChange = vi.fn();
const onSessionConfigChange = vi.fn();

async function render(props: Partial<ComponentProps<typeof ComposerAgentSelector>> = {}) {
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
        onSessionConfigChange={onSessionConfigChange}
        {...props}
      />,
    ),
  );
}

beforeEach(() => {
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
// Base UI moves focus into and out of submenus on the next animation frame.
const nextFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
async function press(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await nextFrames();
  });
}
const menus = () => [...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-closed])')];
const subTriggers = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')].map(
    (trigger) => trigger.textContent,
  );
const subTrigger = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')].find(
    (trigger) => trigger.textContent?.startsWith(name),
  )!;
async function openSubmenu(name: string) {
  await act(async () => subTrigger(name).click());
  const visible = menus();
  return visible[visible.length - 1];
}
async function search(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Search models…"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const rowsOf = (menu: HTMLElement) => [
  ...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
];
const names = (items: Iterable<HTMLElement>) => [...items].map((row) => row.textContent);
const effortSlider = () =>
  document.querySelector<HTMLElement>('[role="group"][aria-label="Effort"]');
const effortSteps = () => [
  ...(effortSlider()?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []),
];
const labelsOf = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-label"]')].map(
    (label) => label.textContent,
  );
const rowsIn = (menu: HTMLElement, section: string) =>
  [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-label"]')]
    .find((label) => label.textContent === section)!
    .closest('[role="group"]')!
    .querySelectorAll<HTMLElement>('[role="menuitemradio"]');

describe("composer model selector", () => {
  it("opens on a short menu of Provider and Model rows showing the current choice", async () => {
    await render();
    await open();
    expect(subTriggers()).toEqual(["ProviderAthas", "ModelAutomatic"]);
    expect(menus()).toHaveLength(1);
    expect(rowsOf(menus()[0])).toHaveLength(0);
    expect(document.body.textContent).toContain("Configure models…");
  });

  it("lists Athas, connected providers and installed agents under Provider", async () => {
    await render();
    await open();
    const providers = await openSubmenu("Provider");
    expect(names(rowsOf(providers))).toEqual(["AthasSign in", "OpenAI", "Codex", "Gemini CLI"]);
    expect(labelsOf(providers)).toEqual(["Your API keys", "Agents"]);
    expect(rowsOf(providers)[0].getAttribute("aria-checked")).toBe("true");
    expect(state.loadModels).not.toHaveBeenCalledWith("anthropic");
  });

  it("switches provider to its first model and returns to the top level", async () => {
    await render();
    await open();
    const providers = await openSubmenu("Provider");
    await act(async () => rowsOf(providers)[1].click());
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("gpt-test", "openai");
    expect(onAgentChange).not.toHaveBeenCalled();
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(subTrigger("Provider"));
  });

  it("switches to an agent from the Provider submenu", async () => {
    await render();
    await open();
    const providers = await openSubmenu("Provider");
    await act(async () => rowsIn(providers, "Agents")[1].click());
    expect(onAgentChange).toHaveBeenCalledExactlyOnceWith("gemini");
    expect(onModelChange).not.toHaveBeenCalled();
  });

  it("puts recommended Athas models on top of a searchable model list", async () => {
    await render();
    await open();
    const models = await openSubmenu("Model");
    expect(labelsOf(models)).toEqual(["Recommended", "All models"]);
    expect(names(rowsIn(models, "Recommended"))).toEqual(["Automatic", "Claude Sonnet 5"]);
    expect(rowsIn(models, "All models")).toHaveLength(9);
    const sonnet = rowsIn(models, "All models")[2];
    expect(sonnet.getAttribute("title")).toContain("Anthropic");
    expect(sonnet.getAttribute("title")).toContain("billed at list price +35%");
    await act(async () => rowsIn(models, "All models")[1].click());
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("moonshotai/kimi-k2.6", "athas");
  });

  it("filters the model list as the user searches", async () => {
    await render();
    await open();
    const models = await openSubmenu("Model");
    await search("kimi");
    expect(labelsOf(models)).toEqual([]);
    expect(names(rowsOf(models))).toEqual(["Kimi K2.6"]);
    await search("anthropic");
    expect(names(rowsOf(models))).toEqual(["Claude Sonnet 5"]);
    await search("missing-model");
    expect(rowsOf(models)).toHaveLength(0);
    expect(models.textContent).toContain("No matching models");
  });

  it("shows a short provider list without search and selects from it", async () => {
    await render({ providerId: "openai", modelId: "gpt-test" });
    await open();
    expect(subTriggers()).toEqual(["ProviderOpenAI", "ModelGPT Test"]);
    const models = await openSubmenu("Model");
    expect(document.querySelector('input[placeholder="Search models…"]')).toBeNull();
    expect(names(rowsOf(models))).toEqual(["GPT Test", "GPT Mini"]);
    await act(async () => rowsOf(models)[1].click());
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("gpt-mini", "openai");
  });

  it("offers Codex models and reasoning effort while Codex is the agent", async () => {
    await render({ currentAgentId: "codex" });
    await open();
    expect(subTriggers()).toEqual(["ProviderCodex", "Modelcodex-test"]);
    expect(effortSlider()?.textContent).toContain("Medium · Default");
    expect(effortSteps().map((step) => step.getAttribute("aria-label"))).toEqual(["Low", "Medium"]);
    expect(effortSteps()[1].getAttribute("aria-checked")).toBe("true");
    const models = await openSubmenu("Model");
    expect(names(rowsOf(models))).toEqual(["Default", "Codex Test"]);
    await act(async () => effortSteps()[0].click());
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ model: "codex-test", effort: "low" });
  });

  it("shows the Effort slider only when the agent's model has an effort scale", async () => {
    await render({ currentAgentId: "gemini", sessionConfigOptions: [effortOption] });
    await open();
    expect(subTriggers()).toEqual(["ProviderGemini CLI"]);
    expect(effortSlider()?.textContent).toContain("High");
    await act(async () => effortSteps()[0].click());
    expect(onSessionConfigChange).toHaveBeenCalledExactlyOnceWith("effort", "low");

    await render({ currentAgentId: "gemini", sessionConfigOptions: [] });
    await open();
    expect(effortSlider()).toBeNull();

    await render({ sessionConfigOptions: [effortOption] });
    await open();
    expect(effortSlider()).toBeNull();
  });

  it("keeps an agent's default effort apart from the scale as Auto", async () => {
    const withDefault = {
      ...effortOption,
      kind: {
        ...effortOption.kind,
        currentValue: "default",
        options: [{ id: "default", name: "Default" }, ...effortOption.kind.options],
      },
    };
    await render({ currentAgentId: "gemini", sessionConfigOptions: [withDefault] });
    await open();
    const [auto, ...levels] = effortSteps();
    expect(auto.textContent).toBe("Auto");
    expect(auto.getAttribute("aria-checked")).toBe("true");
    expect(levels.map((step) => step.getAttribute("aria-label"))).toEqual(["Low", "High"]);
    await act(async () => {
      effortSlider()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(onSessionConfigChange).toHaveBeenCalledExactlyOnceWith("effort", "low");
  });

  it("shows a loading Model row while an agent's session opens, never an empty one", async () => {
    await render({ currentAgentId: "gemini", isLoadingSessionConfig: true });
    await open();
    expect(subTriggers()).toEqual(["ProviderGemini CLI", "ModelGemini CLI"]);
    const loading = await openSubmenu("Model");
    expect(loading.textContent).toContain("Loading…");
    expect(loading.textContent).not.toContain("No models available");
    expect(rowsOf(loading)).toEqual([]);
  });

  it("offers the agent's last known models while its session opens", async () => {
    const modelOption = {
      id: "model",
      name: "Model",
      category: "model",
      kind: {
        type: "select" as const,
        currentValue: "pro",
        options: [
          { id: "flash", name: "Flash" },
          { id: "pro", name: "Pro" },
        ],
      },
    };
    await render({
      currentAgentId: "gemini",
      sessionConfigOptions: [modelOption],
      isLoadingSessionConfig: true,
    });
    await open();
    expect(subTriggers()).toEqual(["ProviderGemini CLI", "ModelPro"]);
    const models = await openSubmenu("Model");
    expect(models.textContent).toContain("Loading…");
    expect(names(rowsOf(models))).toEqual(["Flash", "Pro"]);
    await act(async () => rowsOf(models)[0].click());
    expect(onSessionConfigChange).toHaveBeenCalledExactlyOnceWith("model", "flash");
  });

  it("opens and closes submenus from the keyboard", async () => {
    await render();
    await open();
    const provider = subTrigger("Provider");
    await act(async () => provider.focus());
    await press(provider, "ArrowRight");
    expect(menus()).toHaveLength(2);
    const submenu = menus()[1];
    const active = document.activeElement as HTMLElement;
    expect(submenu.contains(active)).toBe(true);
    await press(active, "ArrowLeft");
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(provider);

    await press(provider, "ArrowRight");
    await press(document.activeElement!, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("OpenAI");
    await press(document.activeElement!, "Enter");
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith("gpt-test", "openai");
    expect(menus()).toHaveLength(1);
  });

  it("opens the existing AI configuration from the menu", async () => {
    await render();
    await open();
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((row) => row.textContent === "Configure models…")!
        .click(),
    );
    expect(state.configure).toHaveBeenCalledExactlyOnceWith("ai");
  });
});
