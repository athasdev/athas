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
    const models = getProviderById("openai")?.models;
    const modelIds = models?.map((model) => model.id);

    expect(modelIds).toEqual(
      expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]),
    );
    expect(models?.find((model) => model.id === "gpt-5.6-sol")).toMatchObject({
      contextWindow: 1050000,
      maxOutputTokens: 128000,
    });
  });

  it("keeps other provider fallbacks on current model families", () => {
    expect(getProviderById("anthropic")?.models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"]),
    );
    expect(getProviderById("gemini")?.models[0]).toMatchObject({
      id: "gemini-3.7-flash",
      contextWindow: 1048576,
      maxOutputTokens: 65536,
    });
    expect(getProviderById("grok")?.models[0]).toMatchObject({
      id: "grok-4.6",
      contextWindow: 500000,
    });
    expect(getProviderById("mistral")?.models[0]).toMatchObject({
      id: "mistral-medium-3-5",
      contextWindow: 262144,
    });
    expect(getProviderById("qwen")?.models[0]).toMatchObject({
      id: "qwen3.8-max",
      contextWindow: 1000000,
      maxOutputTokens: 131072,
    });
    expect(getProviderById("qwen")?.models[1]).toMatchObject({
      id: "qwen3.8-flash",
      contextWindow: 1000000,
      maxOutputTokens: 131072,
    });
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
