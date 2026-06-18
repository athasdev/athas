import { describe, expect, it } from "vite-plus/test";
import {
  registerAIProviderExtension,
  unregisterAIProviderExtension,
} from "@/features/ai/services/providers/ai-provider-registry";
import {
  AIProvider,
  type ProviderHeaders,
} from "@/features/ai/services/providers/ai-provider-interface";
import { getAvailableProviders, getProviderById } from "@/features/ai/types/providers.types";

class TestProvider extends AIProvider {
  buildHeaders(): ProviderHeaders {
    return {};
  }

  buildPayload(): Record<string, never> {
    return {};
  }

  validateApiKey(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

describe("AI provider extension registry", () => {
  it("adds and removes extension providers from provider lookups", () => {
    const extensionId = "athas.test.ai-provider";

    registerAIProviderExtension({
      extensionId,
      provider: {
        id: "test-ai-provider",
        name: "Test AI Provider",
        apiUrl: "https://example.test/v1/chat",
        requiresApiKey: true,
        models: [{ id: "test-model", name: "Test Model", maxTokens: 4096 }],
      },
      createProvider: (config) => new TestProvider(config),
    });

    expect(getProviderById("test-ai-provider")?.name).toBe("Test AI Provider");
    expect(getAvailableProviders().some((provider) => provider.id === "test-ai-provider")).toBe(
      true,
    );

    unregisterAIProviderExtension(extensionId);

    expect(getProviderById("test-ai-provider")).toBeUndefined();
    expect(getAvailableProviders().some((provider) => provider.id === "test-ai-provider")).toBe(
      false,
    );
  });
});
