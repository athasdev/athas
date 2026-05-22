import { describe, expect, it } from "vite-plus/test";
import { getCustomModelOptions } from "@/features/ai/lib/custom-model-options";

describe("custom model options", () => {
  it("exposes chat and autocomplete custom models for the custom provider", () => {
    expect(
      getCustomModelOptions({
        providerId: "custom",
        modelId: "",
        customModelId: " qwen2.5-coder:7b ",
        autocompleteCustomModelId: "mimo-v2.5-pro",
      }),
    ).toEqual([
      { id: "qwen2.5-coder:7b", name: "qwen2.5-coder:7b", maxTokens: 4096 },
      { id: "mimo-v2.5-pro", name: "mimo-v2.5-pro", maxTokens: 4096 },
    ]);
  });

  it("does not leak custom models into built-in providers", () => {
    expect(
      getCustomModelOptions({
        providerId: "openai",
        modelId: "gpt-5.5",
        customModelId: "qwen2.5-coder:7b",
        autocompleteCustomModelId: "mimo-v2.5-pro",
      }),
    ).toEqual([]);
  });
});
