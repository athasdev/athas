// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const http = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: http.fetch }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

import { enableMapSet } from "immer";
import { commands } from "@/bindings/commands";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAIModelOptions } from "../hooks/use-ai-model-options";
import { AIProvider } from "../services/providers/ai-provider-interface";
import {
  registerAIProviderExtension,
  unregisterAIProviderExtension,
} from "../services/providers/ai-provider-registry";
import { useAIChatStore } from "../stores/ai-chat.store";

enableMapSet();

const getModels = vi.fn();

class ListedProvider extends AIProvider {
  buildHeaders() {
    return {};
  }
  buildPayload() {
    return {};
  }
  async validateApiKey() {
    return true;
  }
  async getModels(apiKey?: string) {
    return getModels(apiKey);
  }
}

type Options = ReturnType<typeof useAIModelOptions>;
let root: Root;
let options: Options;
const onChange = vi.fn();

function Harness(props: { providerId: string; modelId: string; withChange?: boolean }) {
  options = useAIModelOptions(
    props.providerId,
    props.modelId,
    props.withChange ? onChange : undefined,
  );
  return null;
}

async function render(providerId: string, modelId = "", withChange = false) {
  await act(async () => root.render(createElement(Harness, { providerId, modelId, withChange })));
  await act(async () => {});
}

function register(requiresApiKey: boolean) {
  registerAIProviderExtension({
    extensionId: "test.models",
    provider: {
      id: "listed",
      name: "Listed",
      apiUrl: "https://listed.test",
      requiresApiKey,
      models: [{ id: "static-1", name: "Static One" }],
    },
    createProvider: (config) => new ListedProvider(config),
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  useAIChatStore.setState({ dynamicModels: {} });
  vi.spyOn(commands, "getAiProviderToken").mockResolvedValue("key");
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  unregisterAIProviderExtension("test.models");
  vi.restoreAllMocks();
});

describe("useAIModelOptions", () => {
  it("fetches the provider's models with its key and caches them", async () => {
    register(true);
    getModels.mockResolvedValue([{ id: "remote-1", name: "Remote One" }]);

    await render("listed", "remote-1");

    expect(getModels).toHaveBeenCalledWith("key");
    expect(useAIChatStore.getState().dynamicModels.listed).toEqual([
      { id: "remote-1", name: "Remote One" },
    ]);
    expect(options.availableModels.map((model) => model.id)).toContain("remote-1");
    expect(options.currentModelName).toBe("Remote One");
    expect(options.isLoadingModels).toBe(false);
    expect(options.modelFetchError).toBeNull();

    await render("listed", "remote-1");
    expect(getModels).toHaveBeenCalledTimes(1);
  });

  it("shows a loading label until models arrive", async () => {
    register(true);
    let resolve: (models: unknown[]) => void = () => {};
    getModels.mockReturnValue(new Promise((done) => (resolve = done)));

    await render("listed");
    expect(options.isLoadingModels).toBe(true);
    expect(options.currentModelName).toBe("Loading models…");

    await act(async () => resolve([{ id: "late", name: "Late" }]));
    expect(options.isLoadingModels).toBe(false);
  });

  it("reports an empty list and connection errors, and retries", async () => {
    register(true);
    getModels.mockResolvedValueOnce([]);
    await render("listed");
    expect(options.modelFetchError).toBe("No models found.");
    expect(options.currentModelName).toBe("Select model");

    getModels.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await act(async () => options.retry());
    await act(async () => {});
    expect(options.modelFetchError).toBe("ECONNREFUSED");

    getModels.mockRejectedValueOnce("weird");
    await act(async () => options.retry());
    await act(async () => {});
    expect(options.modelFetchError).toBe("Could not connect to the provider.");
  });

  it("does not fetch for a key-gated provider without a key", async () => {
    register(true);
    vi.mocked(commands.getAiProviderToken).mockResolvedValue(null);
    await render("listed", "static-1");
    expect(getModels).not.toHaveBeenCalled();
    expect(options.isLoadingModels).toBe(false);
    expect(options.currentModelName).toBe("Static One");
  });

  it("picks the first model when none is selected", async () => {
    register(false);
    getModels.mockResolvedValue([{ id: "remote-1", name: "Remote One" }]);
    await render("listed", "", true);
    expect(onChange).toHaveBeenCalledWith(options.availableModels[0].id);
  });

  it("explains an Ollama server without installed models", async () => {
    http.fetch.mockResolvedValue(new Response(JSON.stringify({ models: [] })));
    await render("ollama");
    expect(options.modelFetchError).toBe("No models detected. Please install a model in Ollama.");
  });

  it("offers the configured custom model without fetching", async () => {
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, aiCustomModelId: "my-llm" },
    });
    await render("custom", "unsaved-model");
    expect(options.isCustomProvider).toBe(true);
    expect(options.isLoadingModels).toBe(false);
    expect(options.availableModels.map((model) => model.id)).toContain("my-llm");
    expect(options.currentModelName).toBe("unsaved-model");
  });
});
