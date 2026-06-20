import { describe, expect, it } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";
import { getAIModelSelectionPatch } from "@/features/settings/lib/ai-model-selection";

describe("AI model selection settings", () => {
  it("selects the configured custom chat model when switching to the custom provider", () => {
    const settings = {
      ...getDefaultSettingsSnapshot(),
      aiProviderId: "custom",
      aiCustomModelId: "qwen2.5-coder:7b",
      aiAutocompleteCustomModelId: "mimo-v2.5-pro",
    };

    expect(getAIModelSelectionPatch(settings, "aiProviderId")).toEqual({
      aiModelId: "qwen2.5-coder:7b",
    });
  });

  it("keeps the chat model in sync when the custom chat model changes", () => {
    const settings = {
      ...getDefaultSettingsSnapshot(),
      aiProviderId: "custom",
      aiModelId: "old-model",
      aiCustomModelId: "local-model:latest",
    };

    expect(getAIModelSelectionPatch(settings, "aiCustomModelId")).toEqual({
      aiModelId: "local-model:latest",
    });
  });

  it("uses the custom autocomplete model as a fallback for custom chat", () => {
    const settings = {
      ...getDefaultSettingsSnapshot(),
      aiProviderId: "custom",
      aiCustomModelId: "",
      aiAutocompleteCustomModelId: "mimo-v2.5-pro",
    };

    expect(getAIModelSelectionPatch(settings, "aiAutocompleteCustomModelId")).toEqual({
      aiModelId: "mimo-v2.5-pro",
    });
  });

  it("does not update the chat model for built-in providers", () => {
    const settings = {
      ...getDefaultSettingsSnapshot(),
      aiProviderId: "openai",
      aiCustomModelId: "local-model:latest",
    };

    expect(getAIModelSelectionPatch(settings, "aiCustomModelId")).toEqual({});
  });
});
