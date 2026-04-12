import { describe, expect, it } from "vite-plus/test";
import { resolveProviderModelSelection } from "./ai-model-selection";

describe("resolveProviderModelSelection", () => {
  it("keeps the explicitly selected model when it belongs to the provider", () => {
    expect(resolveProviderModelSelection("openai", "gpt-5-nano")).toEqual({
      providerId: "openai",
      modelId: "gpt-5-nano",
    });
  });

  it("falls back to the provider default when the preferred model does not belong to it", () => {
    expect(resolveProviderModelSelection("anthropic", "gpt-5-nano")).toEqual({
      providerId: "anthropic",
      modelId: "claude-opus-4-6",
    });
  });
});
