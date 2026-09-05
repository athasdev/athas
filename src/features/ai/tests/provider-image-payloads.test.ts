import { describe, expect, it } from "vite-plus/test";
import { OpenAIProvider } from "../services/providers/openai-provider";
import { OpenAICompatibleProvider } from "../services/providers/openai-compatible-provider";
import { OpenRouterProvider } from "../services/providers/openrouter-provider";
import { GrokProvider } from "../services/providers/grok-provider";
import { MistralProvider } from "../services/providers/mistral-provider";
import { OllamaProvider } from "../services/providers/ollama-provider";
import { AnthropicProvider } from "../services/providers/anthropic-provider";
import { GeminiProvider } from "../services/providers/gemini-provider";
import type { StreamRequest } from "../services/providers/ai-provider-interface";

const config = {
  id: "test",
  name: "Test",
  apiUrl: "https://example.com",
  requiresApiKey: true,
  maxTokens: 100,
};
const images = [{ mediaType: "image/png", data: "YWJj" }];
const request: StreamRequest = {
  modelId: "test",
  maxTokens: 100,
  temperature: 0.7,
  messages: [
    { role: "system", content: "Instructions" },
    { role: "user", content: "Explain", images },
    { role: "assistant", content: "An image" },
    { role: "user", content: "", images },
  ],
};

describe("provider image payloads", () => {
  it.each([
    OpenAIProvider,
    OpenAICompatibleProvider,
    OpenRouterProvider,
    GrokProvider,
    MistralProvider,
    OllamaProvider,
  ])(
    "preserves image-only and historical images in OpenAI-compatible requests (%s)",
    (Provider) => {
      const payload = new Provider(config).buildPayload(request);
      expect(payload.messages[0]).toEqual(request.messages[0]);
      expect(payload.messages[1]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "Explain" },
          { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
        ],
      });
      expect(payload.messages[3].content).toEqual([
        { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
      ]);
      expect(payload.messages[1]).not.toHaveProperty("images");
    },
  );

  it("uses Anthropic image source blocks without emitting an empty text block", () => {
    const payload = new AnthropicProvider(config).buildPayload(request) as {
      messages: { content: unknown }[];
    };
    expect(payload.messages[2].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } },
    ]);
  });

  it("uses Gemini inline image parts in both history and the current prompt", () => {
    const payload = new GeminiProvider(config).buildPayload(request);
    expect(payload.contents[0].parts).toContainEqual({
      inlineData: { mimeType: "image/png", data: "YWJj" },
    });
    expect(payload.contents[2].parts).toEqual([
      { inlineData: { mimeType: "image/png", data: "YWJj" } },
    ]);
  });
});
