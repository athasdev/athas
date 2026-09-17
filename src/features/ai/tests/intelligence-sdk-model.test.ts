import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getIntelligenceSdkModel } from "../intelligence/services/intelligence-sdk-model";

const mocks = vi.hoisted(() => ({
  compatible: vi.fn(),
  fetch: vi.fn(),
  token: vi.fn(),
  settings: {
    aiAutocompleteProvider: "custom",
    aiAutocompleteCustomModelId: "legacy-model",
    aiAutocompleteCustomBaseUrl: "http://localhost:9000/v1",
    aiCustomBaseUrl: "http://localhost:9001/v1",
    ollamaBaseUrl: "http://localhost:11434",
  },
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (config: unknown) => {
    mocks.compatible(config);
    return { chatModel: (id: string) => ({ id }) };
  },
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.fetch }));
vi.mock("@/features/ai/services/ai-token-service", () => ({ getProviderApiToken: mocks.token }));
vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: mocks.settings }) },
}));
vi.mock("@/features/ai/services/providers/ai-provider-registry", () => ({
  getProvider: (id: string) => ({
    name: id,
    requiresApiKey: false,
    apiUrl: `https://${id}.test/v1/chat/completions`,
    buildHeaders: async () => ({ Authorization: "Bearer local-test-key" }),
  }),
}));
vi.mock("@/utils/api-base", () => ({ getApiBase: () => "https://athas.test" }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockImplementation(async (provider: string) => `${provider}-test-key`);
});
describe("Intelligence SDK connections", () => {
  it("preserves a separate legacy autocomplete endpoint and key", async () => {
    await getIntelligenceSdkModel("custom", "legacy-model", "autocomplete");
    expect(mocks.compatible).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://localhost:9000/v1",
        apiKey: "autocomplete-custom-test-key",
      }),
    );
    await getIntelligenceSdkModel("custom", "chat-model", "agent");
    expect(mocks.compatible).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseURL: "http://localhost:9001/v1", apiKey: "custom-test-key" }),
    );
  });
  it("connects personal OpenRouter directly without an Athas account", async () => {
    await getIntelligenceSdkModel("openrouter", "user/model");
    expect(mocks.compatible).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://openrouter.test/v1",
        apiKey: "openrouter-test-key",
      }),
    );
  });
  it("pins the first routed hosted model for following agent steps", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("", { headers: { "x-athas-model": "routed-model" } }),
    );
    await getIntelligenceSdkModel("athas", "auto");
    const connection = mocks.compatible.mock.calls[0][0];
    expect(connection.baseURL).toBe("https://athas.test/api/ai");
    await connection.fetch("https://athas.test/api/ai/chat/completions", {
      body: JSON.stringify({ model: "auto" }),
    });
    await connection.fetch("https://athas.test/api/ai/chat/completions", {
      body: JSON.stringify({ model: "auto" }),
    });
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).model).toBe("routed-model");
  });
});
