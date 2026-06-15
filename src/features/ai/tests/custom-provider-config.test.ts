import { describe, expect, it } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";
import {
  resolveCustomProviderBaseUrl,
  resolveCustomProviderModelId,
} from "@/features/ai/lib/custom-provider-config";

describe("custom provider config", () => {
  it("uses chat-specific custom provider settings first", () => {
    const settings = {
      ...getDefaultSettingsSnapshot(),
      aiCustomBaseUrl: "https://chat.example.test/v1",
      aiCustomModelId: "chat-model",
      aiAutocompleteCustomBaseUrl: "https://autocomplete.example.test/v1",
      aiAutocompleteCustomModelId: "autocomplete-model",
    };

    expect(resolveCustomProviderBaseUrl(settings)).toBe("https://chat.example.test/v1");
    expect(resolveCustomProviderModelId(settings, "gpt-5.5")).toBe("chat-model");
  });

  it("falls back to custom autocomplete settings for custom chat", () => {
    const settings = {
      ...getDefaultSettingsSnapshot(),
      aiAutocompleteCustomBaseUrl: "https://autocomplete.example.test/v1",
      aiAutocompleteCustomModelId: "mimo-v2.5-pro",
    };

    expect(resolveCustomProviderBaseUrl(settings)).toBe("https://autocomplete.example.test/v1");
    expect(resolveCustomProviderModelId(settings, "gpt-5.5")).toBe("mimo-v2.5-pro");
  });

  it("preserves an explicit custom chat model that is already selected", () => {
    const settings = {
      ...getDefaultSettingsSnapshot(),
      aiAutocompleteCustomModelId: "mimo-v2.5-pro",
    };

    expect(resolveCustomProviderModelId(settings, "local-model:latest")).toBe("local-model:latest");
  });
});
