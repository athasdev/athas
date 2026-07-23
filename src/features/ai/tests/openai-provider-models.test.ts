import { describe, expect, it } from "vitest";
import { OpenAIProvider } from "@/features/ai/services/providers/openai-provider";
import { getProviderById } from "@/features/ai/types/providers.types";

const provider = new OpenAIProvider({
  id: "openai",
  name: "OpenAI",
  apiUrl: "https://api.openai.com/v1/chat/completions",
  requiresApiKey: true,
  maxTokens: 1050000,
});

describe("OpenAI GPT-5.6 models", () => {
  it("includes the current GPT-5.6 family in the fallback catalog", () => {
    const modelIds = getProviderById("openai")?.models.map((model) => model.id);

    expect(modelIds).toEqual(
      expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
    );
  });

  it("uses reasoning-model payload options for GPT-5.6", () => {
    expect(
      provider.buildPayload({
        modelId: "gpt-5.6-sol",
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 128000,
        temperature: 0.4,
      }),
    ).toEqual({
      model: "gpt-5.6-sol",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      max_completion_tokens: 128000,
    });
  });
});
