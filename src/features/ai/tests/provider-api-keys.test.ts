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
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  getProviderApiToken,
  onProviderApiTokenChange,
  removeProviderApiToken,
  storeProviderApiToken,
  validateProviderApiKey,
} from "../services/ai-token-service";
import { useAIChatStore } from "../stores/ai-chat.store";

enableMapSet();

const initialSettings = useSettingsStore.getState().settings;
let vault: Map<string, string>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const actions = () => useAIChatStore.getState().actions;

beforeEach(() => {
  vi.clearAllMocks();
  vault = new Map();
  vi.spyOn(commands, "getAiProviderToken").mockImplementation(
    async (providerId: string) => vault.get(providerId) ?? null,
  );
  vi.spyOn(commands, "storeAiProviderToken").mockImplementation(
    async (providerId: string, token: string) => {
      vault.set(providerId, token);
      return null;
    },
  );
  vi.spyOn(commands, "removeAiProviderToken").mockImplementation(async (providerId: string) => {
    vault.delete(providerId);
    return null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  useAuthStore.setState({ subscription: null });
  useSettingsStore.setState({ settings: { ...initialSettings, aiProviderId: "openai" } });
  useAIChatStore.setState({ providerApiKeys: new Map(), hasApiKey: false, dynamicModels: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider API token storage", () => {
  it("reads null instead of throwing when secure storage fails", async () => {
    vi.mocked(commands.getAiProviderToken).mockRejectedValueOnce(new Error("keychain locked"));
    expect(await getProviderApiToken("openai")).toBeNull();
  });

  it("notifies listeners after a token is stored or removed", async () => {
    const changes: string[] = [];
    const unsubscribe = onProviderApiTokenChange((providerId) => changes.push(providerId));

    await storeProviderApiToken("openai", "sk-1");
    await removeProviderApiToken("openai");
    unsubscribe();
    await storeProviderApiToken("mistral", "m");

    expect(changes).toEqual(["openai", "openai"]);
    expect(vault.get("mistral")).toBe("m");
  });

  it("rethrows storage failures without notifying", async () => {
    const listener = vi.fn();
    const unsubscribe = onProviderApiTokenChange(listener);
    vi.mocked(commands.storeAiProviderToken).mockRejectedValueOnce(new Error("denied"));
    vi.mocked(commands.removeAiProviderToken).mockRejectedValueOnce(new Error("denied"));

    await expect(storeProviderApiToken("openai", "x")).rejects.toThrow("denied");
    await expect(removeProviderApiToken("openai")).rejects.toThrow("denied");
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("validates keys with the provider and rejects unknown providers", async () => {
    http.fetch.mockResolvedValueOnce(json({ data: [] }));
    expect(await validateProviderApiKey("openai", "sk-ok")).toBe(true);
    expect(await validateProviderApiKey("not-a-provider", "x")).toBe(false);
  });
});

describe("provider API key actions", () => {
  it("stores a validated key and marks the default provider usable", async () => {
    http.fetch.mockResolvedValueOnce(json({ data: [] }));
    actions().setDynamicModels("openai", [{ id: "stale", name: "Stale" }]);

    expect(await actions().saveApiKey("openai", "sk-valid")).toBe(true);

    expect(vault.get("openai")).toBe("sk-valid");
    expect(useAIChatStore.getState().providerApiKeys.get("openai")).toBe(true);
    expect(useAIChatStore.getState().hasApiKey).toBe(true);
    expect(useAIChatStore.getState().dynamicModels.openai).toBeUndefined();
    expect(actions().hasProviderApiKey("openai")).toBe(true);
  });

  it("does not store a key the provider rejects", async () => {
    http.fetch.mockResolvedValueOnce(json({ error: "invalid" }, 401));

    expect(await actions().saveApiKey("openai", "sk-bad")).toBe(false);

    expect(vault.has("openai")).toBe(false);
    expect(actions().hasProviderApiKey("openai")).toBe(false);
  });

  it("returns false when storing a validated key fails", async () => {
    http.fetch.mockResolvedValueOnce(json({ data: [] }));
    vi.mocked(commands.storeAiProviderToken).mockRejectedValueOnce(new Error("keychain"));

    expect(await actions().saveApiKey("openai", "sk-valid")).toBe(false);
    expect(actions().hasProviderApiKey("openai")).toBe(false);
  });

  it("removes a key and revokes access", async () => {
    vault.set("openai", "sk");
    await actions().checkApiKey("openai");
    expect(actions().hasProviderApiKey("openai")).toBe(true);

    await actions().removeApiKey("openai");

    expect(vault.has("openai")).toBe(false);
    expect(actions().hasProviderApiKey("openai")).toBe(false);
    expect(useAIChatStore.getState().hasApiKey).toBe(false);
  });

  it("propagates removal failures", async () => {
    vi.mocked(commands.removeAiProviderToken).mockRejectedValueOnce(new Error("keychain"));
    await expect(actions().removeApiKey("openai")).rejects.toThrow("keychain");
  });

  it("shares one lookup between concurrent checks", async () => {
    vault.set("mistral", "m");
    await Promise.all([actions().checkApiKey("mistral"), actions().checkApiKey("mistral")]);
    expect(commands.getAiProviderToken).toHaveBeenCalledTimes(1);
    expect(actions().hasProviderApiKey("mistral")).toBe(true);
  });

  it("ignores a check that finishes after the key was replaced", async () => {
    let release: (value: string | null) => void = () => {};
    vi.mocked(commands.getAiProviderToken).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const staleCheck = actions().checkApiKey("openai");

    http.fetch.mockResolvedValueOnce(json({ data: [] }));
    await actions().saveApiKey("openai", "sk-new");
    release(null);
    await staleCheck;

    expect(actions().hasProviderApiKey("openai")).toBe(true);
  });

  it("treats key lookup failures as no key", async () => {
    vi.mocked(commands.getAiProviderToken).mockRejectedValueOnce(new Error("locked"));
    await actions().checkApiKey("openai");
    expect(useAIChatStore.getState().providerApiKeys.get("openai")).toBe(false);
  });

  it("allows keyless providers and gates Athas on sign-in", async () => {
    await actions().checkAllProviderApiKeys();
    const state = useAIChatStore.getState();
    expect(state.providerApiKeys.get("ollama")).toBe(true);
    expect(state.providerApiKeys.get("athas")).toBe(false);
    expect(state.providerApiKeys.get("anthropic")).toBe(false);
    expect(actions().hasProviderApiKey("ollama")).toBe(true);
    expect(actions().hasProviderApiKey("unknown")).toBe(false);

    useAuthStore.setState({ subscription: { status: "free" } as never });
    await actions().checkApiKey("athas");
    expect(actions().hasProviderApiKey("athas")).toBe(true);
  });
});
