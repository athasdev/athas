import { describe, expect, it } from "vite-plus/test";
import { OpenRouterProvider } from "@/features/ai/services/providers/openrouter-provider";

const provider = new OpenRouterProvider({
  id: "openrouter",
  name: "OpenRouter",
  apiUrl: "https://openrouter.ai/api/v1/chat/completions",
  requiresApiKey: true,
  maxTokens: 4096,
});

describe("OpenRouterProvider", () => {
  it("requests streaming chat completions with the current output token field", () => {
    expect(
      provider.buildPayload({
        modelId: "openai/gpt-5.4-mini",
        messages: [{ role: "user", content: "Hello" }],
        maxTokens: 4096,
        temperature: 0.7,
      }),
    ).toEqual({
      model: "openai/gpt-5.4-mini",
      messages: [{ role: "user", content: "Hello" }],
      max_completion_tokens: 4096,
      temperature: 0.7,
      stream: true,
    });
  });

  it("advertises both SSE and buffered JSON response support", () => {
    expect(provider.buildHeaders("secret")).toMatchObject({
      Accept: "text/event-stream, application/json",
      Authorization: "Bearer secret",
      "X-Title": "Athas",
    });
  });
});
