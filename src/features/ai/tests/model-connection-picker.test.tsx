// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ModelConnectionPicker } from "../components/selectors/model-connection-picker";

const state = vi.hoisted(() => ({
  keys: new Map([
    ["openai", true],
    ["ollama", true],
  ]),
  providers: [
    { id: "athas", name: "Athas", models: [] },
    { id: "openai", name: "OpenAI", models: [{ id: "gpt-test", name: "GPT Test" }] },
    { id: "anthropic", name: "Anthropic", models: [] },
    { id: "ollama", name: "Ollama", models: [] },
  ],
  models: {
    athas: [
      { id: "auto", name: "Automatic" },
      { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    ],
    openai: [{ id: "gpt-test", name: "GPT Test" }],
    ollama: [{ id: "llama3", name: "llama3" }],
  } as Record<string, { id: string; name: string }[]>,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("../hooks/use-available-providers", () => ({
  useAvailableProviders: () => state.providers,
  useProviderById: (id: string) => state.providers.find((provider) => provider.id === id),
}));
vi.mock("../hooks/use-ai-model-options", () => ({
  useAIModelOptions: (id: string) => ({
    availableModels: state.models[id] ?? [],
    isLoadingModels: false,
    modelFetchError: null,
  }),
}));
vi.mock("../stores/ai-chat.store", () => ({
  useAIChatStore: (select: (value: unknown) => unknown) =>
    select({ providerApiKeys: state.keys, dynamicModels: {} }),
}));

let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();

async function render(props: Partial<Parameters<typeof ModelConnectionPicker>[0]> = {}) {
  await act(async () =>
    root.render(
      <ModelConnectionPicker
        aria-label="Default model"
        value={{ providerId: "athas", modelId: "auto" }}
        onChange={onChange}
        {...props}
      />,
    ),
  );
}
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
const sections = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-label"]')].map(
    (item) => item.textContent,
  );

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

describe("settings model picker", () => {
  it("names the current choice and offers the same connections as the composer", async () => {
    await render();
    expect(trigger().textContent).toBe("Athas Automatic");
    await act(async () => trigger().click());
    expect(sections()).toEqual(["Athas", "OpenAI", "Ollama"]);
  });

  it("chooses a local model from its connection", async () => {
    await render();
    await act(async () => trigger().click());
    await act(async () =>
      rows()
        .find((row) => row.textContent?.includes("llama3"))!
        .click(),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ providerId: "ollama", modelId: "llama3" });
  });

  it("follows the default until a feature gets its own model", async () => {
    await render({ value: null, inheritLabel: "Same as default" });
    expect(trigger().textContent).toBe("Same as default");
    await act(async () => trigger().click());
    const inherit = rows().find((row) => row.textContent === "Same as default")!;
    expect(inherit.getAttribute("aria-checked")).toBe("true");

    await render({
      value: { providerId: "openai", modelId: "gpt-test" },
      inheritLabel: "Same as default",
    });
    expect(trigger().getAttribute("title")).toBe("GPT Test via OpenAI");
    await act(async () =>
      rows()
        .find((row) => row.textContent === "Same as default")!
        .click(),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("names a feature's saved Automatic choice instead of its raw provider id", async () => {
    await render({ value: { providerId: "auto", modelId: "" }, inheritLabel: "Same as default" });
    expect(trigger().textContent).toBe("Automatic");
  });

  it("offers Athas's one Tab model instead of its chat catalog for Tab completion", async () => {
    await render({ value: null, inheritLabel: "Automatic", purpose: "completion" });
    expect(trigger().textContent).toBe("Automatic");
    await act(async () => trigger().click());
    expect(sections()).toEqual(["Athas", "OpenAI", "Ollama"]);
    expect(rows().map((row) => row.textContent)).toContain("Athas Tab model");
    expect(rows().some((row) => row.textContent?.includes("Kimi"))).toBe(false);
    await act(async () =>
      rows()
        .find((row) => row.textContent?.startsWith("Athas Tab model"))!
        .click(),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ providerId: "athas", modelId: "auto" });

    await render({ value: { providerId: "athas", modelId: "auto" }, purpose: "completion" });
    expect(trigger().textContent).toBe("Athas Tab model");
  });
});
