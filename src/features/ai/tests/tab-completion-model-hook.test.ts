// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useTabCompletionModel } from "../hooks/use-tab-completion-model";
import { defaultIntelligencePreferences } from "../intelligence/lib/intelligence-preferences";
import { useIntelligenceSettingsStore } from "../intelligence/stores/intelligence-settings.store";
import type { IntelligencePreferences } from "../intelligence/types/intelligence.types";

type Tab = ReturnType<typeof useTabCompletionModel>;
let root: Root;
let tab: Tab;
const initialSettings = useSettingsStore.getState().settings;

function Harness() {
  tab = useTabCompletionModel();
  return null;
}

async function render() {
  await act(async () => root.render(createElement(Harness)));
}

function preferences(patch: Partial<IntelligencePreferences> = {}) {
  useIntelligenceSettingsStore.setState({
    preferences: { ...defaultIntelligencePreferences(), ...patch },
    scope: "personal",
    scopes: [{ id: "personal", name: "Personal", canEdit: true }],
    dirty: false,
    loading: false,
    error: null,
  });
}

function settings(patch: Partial<typeof initialSettings>) {
  useSettingsStore.setState({ settings: { ...initialSettings, ...patch } });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAuthStore.setState({ user: null, isAuthenticated: false, subscription: null });
  settings({ aiProviderId: "anthropic", aiModelId: "claude-sonnet-5", aiCompletion: true });
  preferences();
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("useTabCompletionModel", () => {
  it("uses Athas Tab on Automatic for accounts with Intelligence", async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      subscription: { capabilities: { intelligence: true } } as never,
    });
    await render();
    expect(tab).toMatchObject({
      isAutomatic: true,
      shortName: "Athas Tab",
      description: "Automatic: Athas Tab, included in Pro",
      allowed: true,
      enabled: true,
    });
  });

  it("falls back to the default model on the user's own key", async () => {
    await render();
    expect(tab.resolved).toEqual({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    expect(tab.description).toBe(`Automatic: ${tab.shortName} on your ${tab.providerName} key`);
  });

  it("keeps Tab local and warns when an explicit choice leaves the network", async () => {
    settings({
      aiProviderId: "ollama",
      aiModelId: "qwen2.5-coder",
      ollamaBaseUrl: "http://localhost:11434",
    });
    await render();
    expect(tab).toMatchObject({
      isLocal: true,
      description: "Automatic: qwen2.5-coder, runs locally",
    });

    preferences({ tasks: { autocomplete: { providerId: "openai", modelId: "gpt-5.6-luna" } } });
    await render();
    expect(tab.isAutomatic).toBe(false);
    expect(tab.choice).toEqual({ providerId: "openai", modelId: "gpt-5.6-luna" });
    expect(tab.description).toMatch(/on your OpenAI key, sends code off your network$/);
  });

  it("explains why nothing can run", async () => {
    settings({ aiProviderId: "athas", aiModelId: "" });
    await render();
    expect(tab.resolved).toBeNull();
    expect(tab.shortName).toBe("Choose a model");
    expect(tab.description).toBe("Sign in for Athas Tab, or choose your own model");

    useAuthStore.setState({ isAuthenticated: true });
    await render();
    expect(tab.description).toBe("Athas Tab needs Pro, or choose your own model");

    settings({ aiProviderId: "ollama", aiModelId: "", ollamaBaseUrl: "http://localhost:11434" });
    await render();
    expect(tab.description).toBe("Choose a local model; Automatic never uses Athas here");
  });

  it("follows the organization policy", async () => {
    useAuthStore.setState({
      subscription: {
        enterprise: { policy: { managedMode: true, aiCompletionEnabled: false } },
      } as never,
    });
    await render();
    expect(tab.allowed).toBe(false);
  });

  it("stores a choice and saves it to the active scope", async () => {
    const save = vi.fn(async () => {});
    useIntelligenceSettingsStore.setState({
      actions: { ...useIntelligenceSettingsStore.getState().actions, save },
    });
    await render();

    await act(async () => tab.change({ providerId: "mistral", modelId: "codestral-latest" }));
    expect(useIntelligenceSettingsStore.getState().preferences.tasks.autocomplete).toEqual({
      providerId: "mistral",
      modelId: "codestral-latest",
    });
    expect(save).toHaveBeenCalled();

    await act(async () => tab.change(null));
    expect(useIntelligenceSettingsStore.getState().preferences.tasks.autocomplete).toBeUndefined();
  });
});
