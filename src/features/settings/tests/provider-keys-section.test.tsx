import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

const providerApiKeys = new Map([["openai", true]]);

vi.mock("@/features/ai/hooks/use-available-providers", () => ({
  useAvailableProviders: () => [
    { id: "openai", name: "OpenAI", requiresApiKey: true, models: [] },
    {
      id: "anthropic",
      name: "Anthropic",
      requiresApiKey: true,
      apiKeyUrl: "https://console.anthropic.com/settings/keys",
      models: [],
    },
    { id: "ollama", name: "Ollama", requiresApiKey: false, models: [] },
  ],
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: (select: (state: unknown) => unknown) =>
    select({
      providerApiKeys,
      actions: {
        checkAllProviderApiKeys: async () => undefined,
        saveApiKey: async () => true,
        removeApiKey: async () => undefined,
      },
    }),
}));

vi.mock("@/features/ai/services/providers/ai-provider-settings-registry", () => ({
  useAIProviderSettingsActions: () => [],
}));

vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({ subscription: null }),
}));

vi.mock("@/features/ai/components/icons/provider-icons", () => ({
  ProviderIcon: () => null,
}));

const { ProviderKeysSection } = await import("../components/ai/provider-keys-section");

describe("provider keys in Settings", () => {
  const markup = renderToStaticMarkup(<ProviderKeysSection />);

  it("lists each provider that takes a key as one row under API keys", () => {
    expect(markup).toContain('data-settings-section="API keys"');
    expect(markup).toContain('data-setting-row-label="OpenAI API key"');
    expect(markup).toContain('data-setting-row-label="Anthropic API key"');
    expect(markup).not.toContain('data-setting-row-label="Ollama API key"');
  });

  it("shows a configured key as one row with a reset action", () => {
    expect(markup).toContain("API key configured");
    expect(markup).toContain("Reset Key");
  });

  it("offers an inline key field with a link to get a key when none is saved", () => {
    expect(markup).toContain('aria-label="Anthropic API key"');
    expect(markup).toContain("console.anthropic.com");
  });
});
