import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const http = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: http.fetch }));

import { AnthropicProvider } from "@/features/ai/services/providers/anthropic-provider";
import { GeminiProvider } from "@/features/ai/services/providers/gemini-provider";
import { GrokProvider } from "@/features/ai/services/providers/grok-provider";
import { MistralProvider } from "@/features/ai/services/providers/mistral-provider";
import {
  OllamaProvider,
  checkOllamaConnection,
  fetchOllamaModelCapabilities,
} from "@/features/ai/services/providers/ollama-provider";
import { OpenAICompatibleProvider } from "@/features/ai/services/providers/openai-compatible-provider";
import { OpenAIProvider } from "@/features/ai/services/providers/openai-provider";
import { OpenRouterProvider } from "@/features/ai/services/providers/openrouter-provider";

const browserFetch = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function config(id: string, apiUrl = `https://${id}.example/v1/chat/completions`) {
  return { id, name: id, apiUrl, requiresApiKey: true, maxTokens: 4096 };
}

const userWithImage = {
  role: "user" as const,
  content: "What is this?",
  images: [{ data: "AAAA", mediaType: "image/png" }],
};

function lastRequest(mock: ReturnType<typeof vi.fn>) {
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

beforeEach(() => {
  http.fetch.mockReset();
  browserFetch.mockReset();
  vi.stubGlobal("fetch", browserFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenAI provider", () => {
  const provider = new OpenAIProvider(config("openai"));

  it("returns no models without an API key and never hits the network", async () => {
    expect(await provider.getModels()).toEqual([]);
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("lists chat models only, preferred models first, with readable names", async () => {
    http.fetch.mockResolvedValue(
      json({
        data: [
          { id: "whisper-1" },
          { id: "gpt-4o-audio-preview" },
          { id: "gpt-4o-realtime" },
          { id: "dall-e-3" },
          { id: "gpt-image-1" },
          { id: "omni-moderation-latest" },
          { id: "gpt-4o-mini-tts" },
          { id: "chatgpt-4o-latest" },
          { id: "gpt-zz-custom" },
          { id: "gpt-4o" },
          { id: "o3" },
          { id: "gpt-5.5" },
        ],
      }),
    );

    const models = await provider.getModels("sk-test");

    expect(models).toEqual([
      { id: "gpt-5.5", name: "GPT 5.5" },
      { id: "gpt-4o", name: "GPT 4O" },
      { id: "o3", name: "O3" },
      { id: "gpt-zz-custom", name: "GPT ZZ Custom" },
    ]);
    const request = lastRequest(http.fetch);
    expect(request.url).toBe("https://api.openai.com/v1/models");
    expect(request.headers.Authorization).toBe("Bearer sk-test");
  });

  it("returns no models on HTTP errors and network failures", async () => {
    http.fetch.mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
    expect(await provider.getModels("bad")).toEqual([]);

    http.fetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.getModels("sk-test")).toEqual([]);
  });

  it("validates keys from the models endpoint status", async () => {
    http.fetch.mockResolvedValueOnce(json({ data: [] }));
    expect(await provider.validateApiKey("sk-good")).toBe(true);
    expect(lastRequest(http.fetch).headers.Authorization).toBe("Bearer sk-good");

    http.fetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.validateApiKey("sk-bad")).toBe(false);

    http.fetch.mockRejectedValueOnce(new Error("dns"));
    expect(await provider.validateApiKey("sk-any")).toBe(false);
  });

  it("keeps temperature and max_tokens for classic chat models", () => {
    expect(
      provider.buildPayload({
        modelId: "gpt-4o",
        messages: [userWithImage],
        maxTokens: 1000,
        temperature: 0.3,
      }),
    ).toEqual({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          ],
        },
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 1000,
    });
  });

  it("uses max_completion_tokens but keeps temperature for gpt-4.1", () => {
    const payload = provider.buildPayload({
      modelId: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 500,
      temperature: 0.2,
    });
    expect(payload).toMatchObject({ max_completion_tokens: 500, temperature: 0.2 });
    expect(payload).not.toHaveProperty("max_tokens");
  });

  it("omits the authorization header without a key", () => {
    expect(provider.buildHeaders()).toEqual({ "Content-Type": "application/json" });
  });
});

describe("OpenAI-compatible provider", () => {
  it("normalizes the base URL into a chat completions endpoint", () => {
    const provider = new OpenAICompatibleProvider(config("custom", ""));
    provider.setBaseUrl("  https://llm.local/v1///  ");
    expect(provider.buildUrl()).toBe("https://llm.local/v1/chat/completions");

    provider.setBaseUrl("https://llm.local/v1/chat/completions/");
    expect(provider.buildUrl()).toBe("https://llm.local/v1/chat/completions");
  });

  it("fails clearly when no base URL is configured", () => {
    const provider = new OpenAICompatibleProvider(config("custom", ""));
    expect(() => provider.buildUrl()).toThrow("Custom provider base URL is required.");
  });

  it("falls back to the configured provider URL", () => {
    const provider = new OpenAICompatibleProvider(config("deepseek", "https://api.deepseek.com"));
    expect(provider.getBaseUrl()).toBe("https://api.deepseek.com");
    expect(provider.buildUrl()).toBe("https://api.deepseek.com/chat/completions");
  });

  it("builds a streaming payload with an optional response format", () => {
    const provider = new OpenAICompatibleProvider(config("custom"));
    const request = {
      modelId: "local-model",
      messages: [{ role: "user" as const, content: "hi" }],
      maxTokens: 256,
      temperature: 0.5,
    };
    expect(provider.buildPayload(request)).toEqual({
      model: "local-model",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 256,
      temperature: 0.5,
      stream: true,
    });
    expect(provider.buildPayload({ ...request, responseFormat: "json_object" })).toMatchObject({
      response_format: { type: "json_object" },
    });
  });

  it("sends the bearer token only when a key exists", () => {
    const provider = new OpenAICompatibleProvider(config("custom"));
    expect(provider.buildHeaders("k")).toMatchObject({ Authorization: "Bearer k" });
    expect(provider.buildHeaders()).not.toHaveProperty("Authorization");
  });

  it("reads models from either data or models arrays and skips blank ids", async () => {
    const provider = new OpenAICompatibleProvider(config("custom"));
    provider.setBaseUrl("https://llm.local/v1");

    http.fetch.mockResolvedValueOnce(
      json({
        data: [
          { id: " qwen ", max_context_length: 32000 },
          { id: "  " },
          { name: "nameless" },
          { id: "llama", name: "Llama 3" },
        ],
      }),
    );
    expect(await provider.getModels("k")).toEqual([
      { id: "qwen", name: "qwen", contextWindow: 32000 },
      { id: "llama", name: "Llama 3", contextWindow: undefined },
    ]);
    expect(lastRequest(http.fetch).url).toBe("https://llm.local/v1/models");

    http.fetch.mockResolvedValueOnce(json({ models: [{ id: "phi" }] }));
    expect(await provider.getModels()).toEqual([
      { id: "phi", name: "phi", contextWindow: undefined },
    ]);

    http.fetch.mockResolvedValueOnce(json({}, 500));
    expect(await provider.getModels()).toEqual([]);
  });

  it("validates keys against the models endpoint and rejects blank keys", async () => {
    const provider = new OpenAICompatibleProvider(config("custom"));
    provider.setBaseUrl("https://llm.local/v1");

    expect(await provider.validateApiKey("   ")).toBe(false);
    expect(http.fetch).not.toHaveBeenCalled();

    http.fetch.mockResolvedValueOnce(json({ data: [] }));
    expect(await provider.validateApiKey("good")).toBe(true);

    http.fetch.mockResolvedValueOnce(json({}, 403));
    expect(await provider.validateApiKey("bad")).toBe(false);

    http.fetch.mockRejectedValueOnce(new Error("refused"));
    expect(await provider.validateApiKey("any")).toBe(false);
  });
});

describe("Ollama provider", () => {
  it("targets the OpenAI-compatible chat endpoint of the normalized base URL", () => {
    const provider = new OllamaProvider(config("ollama"));
    expect(provider.buildUrl()).toBe("http://localhost:11434/v1/chat/completions");

    provider.setBaseUrl("192.168.1.5:11434/");
    expect(provider.getBaseUrl()).toBe("http://192.168.1.5:11434");
    expect(provider.buildUrl()).toBe("http://192.168.1.5:11434/v1/chat/completions");

    provider.setBaseUrl("not a url ?x=1");
    expect(provider.getBaseUrl()).toBe("http://localhost:11434");
  });

  it("prefers the request key over the stored key and drops empty keys", () => {
    const provider = new OllamaProvider(config("ollama"));
    provider.setApiKey("stored");
    expect(provider.getApiKey()).toBe("stored");
    expect(provider.buildHeaders()).toMatchObject({ Authorization: "Bearer stored" });
    expect(provider.buildHeaders("request")).toMatchObject({ Authorization: "Bearer request" });

    provider.setApiKey("");
    expect(provider.getApiKey()).toBeNull();
    expect(provider.buildHeaders()).toEqual({ "Content-Type": "application/json" });
  });

  it("builds a streaming payload", () => {
    const provider = new OllamaProvider(config("ollama"));
    expect(
      provider.buildPayload({
        modelId: "llama3",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 100,
        temperature: 0.1,
      }),
    ).toEqual({
      model: "llama3",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      temperature: 0.1,
      max_tokens: 100,
    });
  });

  it("lists installed models with parameter sizes and skips unnamed entries", async () => {
    const provider = new OllamaProvider(config("ollama"));
    provider.setApiKey("cloud-key");
    http.fetch.mockResolvedValueOnce(
      json({
        models: [
          { name: "llama3:8b", details: { parameter_size: "8B" } },
          { model: "qwen2" },
          { details: {} },
        ],
      }),
    );

    expect(await provider.getModels()).toEqual([
      { id: "llama3:8b", name: "llama3:8b (8B)", maxOutputTokens: 4096 },
      { id: "qwen2", name: "qwen2", maxOutputTokens: 4096 },
    ]);
    const request = lastRequest(http.fetch);
    expect(request.url).toBe("http://localhost:11434/api/tags");
    expect(request.headers.Authorization).toBe("Bearer cloud-key");
  });

  it("returns no models when the server errors or is unreachable", async () => {
    const provider = new OllamaProvider(config("ollama"));
    http.fetch.mockResolvedValueOnce(json({}, 500));
    expect(await provider.getModels()).toEqual([]);

    http.fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await provider.getModels()).toEqual([]);
  });

  it("times out a hung server instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      http.fetch.mockReturnValue(new Promise(() => {}));
      const pending = checkOllamaConnection("http://localhost:11434");
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates keys against Ollama Cloud when the base URL is local", async () => {
    const provider = new OllamaProvider(config("ollama"));
    http.fetch.mockResolvedValueOnce(json({ models: [] }));
    expect(await provider.validateApiKey("key")).toBe(true);
    expect(lastRequest(http.fetch).url).toBe("https://ollama.com/api/tags");

    provider.setBaseUrl("https://eu.ollama.com");
    http.fetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.validateApiKey("bad")).toBe(false);
    expect(lastRequest(http.fetch).url).toBe("https://eu.ollama.com/api/tags");
  });

  it("reads model capabilities from /api/show", async () => {
    http.fetch.mockResolvedValueOnce(json({ capabilities: ["completion", 3, "tools"] }));
    expect(await fetchOllamaModelCapabilities("http://localhost:11434", "llama3", "k")).toEqual([
      "completion",
      "tools",
    ]);
    const request = lastRequest(http.fetch);
    expect(request.url).toBe("http://localhost:11434/api/show");
    expect(JSON.parse(request.init.body as string)).toEqual({ model: "llama3" });

    http.fetch.mockResolvedValueOnce(json({}));
    expect(await fetchOllamaModelCapabilities("http://localhost:11434", "old")).toBeNull();

    http.fetch.mockResolvedValueOnce(json({}, 404));
    expect(await fetchOllamaModelCapabilities("http://localhost:11434", "missing")).toBeNull();

    http.fetch.mockRejectedValueOnce(new Error("down"));
    expect(await fetchOllamaModelCapabilities("http://localhost:11434", "x")).toBeNull();
  });
});

describe("Mistral provider", () => {
  const provider = new MistralProvider(config("mistral"));

  it("lists models with formatted fallback names", async () => {
    expect(await provider.getModels()).toEqual([]);

    http.fetch.mockResolvedValueOnce(
      json({
        data: [
          { id: "mistral-large-2411", max_context_length: 131072 },
          { id: "codestral-latest", name: "Codestral" },
          { id: "" },
        ],
      }),
    );
    expect(await provider.getModels("m-key")).toEqual([
      { id: "mistral-large-2411", name: "Mistral Large 2411", contextWindow: 131072 },
      { id: "codestral-latest", name: "Codestral", contextWindow: undefined },
    ]);
    expect(lastRequest(http.fetch).headers.Authorization).toBe("Bearer m-key");
  });

  it("falls back to browser fetch when the Tauri HTTP plugin fails", async () => {
    http.fetch.mockRejectedValueOnce(new Error("plugin unavailable"));
    browserFetch.mockResolvedValueOnce(json({ data: [{ id: "open-mistral-7b" }] }));

    expect(await provider.getModels("m-key")).toEqual([
      { id: "open-mistral-7b", name: "Open Mistral 7B", contextWindow: undefined },
    ]);
    expect(lastRequest(browserFetch).url).toBe("https://api.mistral.ai/v1/models");
  });

  it("returns no models when both transports fail or the API rejects", async () => {
    http.fetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.getModels("bad")).toEqual([]);

    http.fetch.mockRejectedValueOnce(new Error("plugin"));
    browserFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await provider.getModels("k")).toEqual([]);
  });

  it("validates keys", async () => {
    http.fetch.mockResolvedValueOnce(json({ data: [] }));
    expect(await provider.validateApiKey("ok")).toBe(true);
    http.fetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.validateApiKey("bad")).toBe(false);
    http.fetch.mockRejectedValueOnce(new Error("plugin"));
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.validateApiKey("x")).toBe(false);
  });

  it("builds an OpenAI-style streaming payload", () => {
    expect(provider.buildHeaders()).toEqual({ "Content-Type": "application/json" });
    expect(
      provider.buildPayload({
        modelId: "mistral-small",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 64,
        temperature: 0.7,
      }),
    ).toEqual({
      model: "mistral-small",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 64,
      temperature: 0.7,
      stream: true,
    });
  });
});

describe("Gemini provider", () => {
  const provider = new GeminiProvider(
    config("gemini", "https://generativelanguage.googleapis.com/v1beta/models"),
  );

  it("maps the conversation to Gemini contents with a system instruction and images", () => {
    const payload = provider.buildPayload({
      modelId: "gemini-2.5-pro",
      messages: [
        { role: "system", content: "Be brief" },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
        userWithImage,
      ],
      maxTokens: 2048,
      temperature: 0.4,
      responseFormat: "json_object",
    });

    expect(payload).toEqual({
      contents: [
        { role: "user", parts: [{ text: "Hi" }] },
        { role: "model", parts: [{ text: "Hello" }] },
        {
          role: "user",
          parts: [
            { text: "What is this?" },
            { inlineData: { mimeType: "image/png", data: "AAAA" } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
      systemInstruction: { parts: [{ text: "Be brief" }] },
    });
  });

  it("omits the system instruction when there is none", () => {
    const payload = provider.buildPayload({
      modelId: "gemini-2.5-pro",
      messages: [{ role: "user", content: "" }],
      maxTokens: 10,
      temperature: 0,
    });
    expect(payload).not.toHaveProperty("systemInstruction");
    expect(payload.contents).toEqual([{ role: "user", parts: [] }]);
    expect(payload.generationConfig).not.toHaveProperty("responseMimeType");
  });

  it("streams from the model-specific endpoint with the key in a header", () => {
    expect(
      provider.buildUrl({
        modelId: "gemini-2.5-flash",
        messages: [],
        maxTokens: 1,
        temperature: 0,
      }),
    ).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent",
    );
    expect(provider.buildHeaders("g-key")).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "g-key",
    });
    expect(provider.buildHeaders()).toEqual({ "Content-Type": "application/json" });
  });

  it("lists only text generation Gemini models", async () => {
    expect(await provider.getModels()).toEqual([]);

    http.fetch.mockResolvedValueOnce(
      json({
        models: [
          {
            name: "models/gemini-2.5-pro",
            displayName: "Gemini 2.5 Pro",
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ["generateContent"],
          },
          { name: "models/learnlm-2.0", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
          { name: "models/imagen-3", supportedGenerationMethods: ["generateContent"] },
        ],
      }),
    );

    expect(await provider.getModels("g-key")).toEqual([
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        contextWindow: 1048576,
        maxOutputTokens: 65536,
      },
      {
        id: "learnlm-2.0",
        name: "learnlm-2.0",
        contextWindow: undefined,
        maxOutputTokens: undefined,
      },
    ]);
    expect(lastRequest(http.fetch).url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?key=g-key",
    );
  });

  it("returns no models and rejects keys on API errors", async () => {
    http.fetch.mockResolvedValueOnce(json({}, 400));
    expect(await provider.getModels("bad")).toEqual([]);

    http.fetch.mockRejectedValueOnce(new Error("plugin"));
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.getModels("k")).toEqual([]);

    http.fetch.mockResolvedValueOnce(json({}, 400));
    expect(await provider.validateApiKey("bad")).toBe(false);
    http.fetch.mockResolvedValueOnce(json({ models: [] }));
    expect(await provider.validateApiKey("good")).toBe(true);
    http.fetch.mockRejectedValueOnce(new Error("plugin"));
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.validateApiKey("x")).toBe(false);
  });
});

describe("Grok provider", () => {
  const provider = new GrokProvider(config("grok"));

  it("expands model aliases into selectable models", async () => {
    expect(await provider.getModels()).toEqual([]);

    browserFetch.mockResolvedValueOnce(
      json({ models: [{ id: "grok-4", aliases: ["grok-4-latest"] }, { id: "grok-code-fast" }] }),
    );
    expect(await provider.getModels("x-key")).toEqual([
      { id: "grok-4", name: "Grok 4" },
      { id: "grok-4-latest", name: "Grok 4 latest" },
      { id: "grok-code-fast", name: "Grok code fast" },
    ]);
    expect(lastRequest(browserFetch).headers.Authorization).toBe("Bearer x-key");
  });

  it("returns no models on failures", async () => {
    browserFetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.getModels("bad")).toEqual([]);
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.getModels("k")).toEqual([]);
  });

  it("validates keys against the api-key endpoint", async () => {
    browserFetch.mockResolvedValueOnce(json({}));
    expect(await provider.validateApiKey("ok")).toBe(true);
    expect(lastRequest(browserFetch).url).toBe("https://api.x.ai/v1/api-key");
    browserFetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.validateApiKey("bad")).toBe(false);
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.validateApiKey("x")).toBe(false);
  });

  it("builds an OpenAI-style payload", () => {
    expect(provider.buildHeaders()).toEqual({ "Content-Type": "application/json" });
    expect(
      provider.buildPayload({
        modelId: "grok-4",
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 10,
        temperature: 1,
      }),
    ).toMatchObject({ model: "grok-4", max_tokens: 10, temperature: 1, stream: true });
  });
});

describe("Anthropic provider", () => {
  const provider = new AnthropicProvider(config("anthropic"));

  it("moves the system prompt to the top level and sends images as base64 blocks", () => {
    expect(
      provider.buildPayload({
        modelId: "claude-sonnet-5",
        messages: [
          { role: "system", content: "Rules" },
          userWithImage,
          { role: "assistant", content: "A cat" },
        ],
        maxTokens: 1024,
        temperature: 0.7,
      }),
    ).toEqual({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      stream: true,
      system: "Rules",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AAAA" },
            },
            { type: "text", text: "What is this?" },
          ],
        },
        { role: "assistant", content: "A cat" },
      ],
    });
  });

  it("sends the key and browser access headers", () => {
    expect(provider.buildHeaders("a-key")).toEqual({
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": "a-key",
    });
  });

  it("lists only Claude models", async () => {
    expect(await provider.getModels()).toEqual([]);
    browserFetch.mockResolvedValueOnce(
      json({
        data: [
          { id: "claude-opus-5", display_name: "Claude Opus 5", max_tokens: 64000 },
          { id: "other-model" },
          { id: "claude-haiku-5" },
        ],
      }),
    );
    expect(await provider.getModels("a-key")).toEqual([
      { id: "claude-opus-5", name: "Claude Opus 5", maxOutputTokens: 64000 },
      { id: "claude-haiku-5", name: "claude-haiku-5", maxOutputTokens: undefined },
    ]);

    browserFetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.getModels("bad")).toEqual([]);
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.getModels("k")).toEqual([]);
  });

  it("treats only 401 and 403 as invalid keys", async () => {
    browserFetch.mockResolvedValueOnce(json({}, 200));
    expect(await provider.validateApiKey("ok")).toBe(true);
    browserFetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.validateApiKey("bad")).toBe(false);
    browserFetch.mockResolvedValueOnce(json({}, 403));
    expect(await provider.validateApiKey("forbidden")).toBe(false);
    browserFetch.mockResolvedValueOnce(json({}, 529));
    expect(await provider.validateApiKey("overloaded")).toBe(true);
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.validateApiKey("x")).toBe(false);
  });
});

describe("OpenRouter provider", () => {
  const provider = new OpenRouterProvider(config("openrouter"));

  it("lists models with context and completion limits", async () => {
    http.fetch.mockResolvedValueOnce(
      json({
        data: [
          {
            id: "anthropic/claude-sonnet-5",
            name: "Claude Sonnet 5",
            context_length: 200000,
            top_provider: { max_completion_tokens: 64000 },
          },
          { id: "meta/llama" },
        ],
      }),
    );
    expect(await provider.getModels()).toEqual([
      {
        id: "anthropic/claude-sonnet-5",
        name: "Claude Sonnet 5",
        contextWindow: 200000,
        maxOutputTokens: 64000,
      },
      {
        id: "meta/llama",
        name: "meta/llama",
        contextWindow: undefined,
        maxOutputTokens: undefined,
      },
    ]);

    http.fetch.mockResolvedValueOnce(json({}, 500));
    expect(await provider.getModels()).toEqual([]);
    http.fetch.mockRejectedValueOnce(new Error("plugin"));
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.getModels()).toEqual([]);
  });

  it("validates keys against the key endpoint", async () => {
    http.fetch.mockResolvedValueOnce(json({}));
    expect(await provider.validateApiKey("ok")).toBe(true);
    expect(lastRequest(http.fetch).url).toBe("https://openrouter.ai/api/v1/key");
    http.fetch.mockResolvedValueOnce(json({}, 401));
    expect(await provider.validateApiKey("bad")).toBe(false);
    http.fetch.mockRejectedValueOnce(new Error("plugin"));
    browserFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await provider.validateApiKey("x")).toBe(false);
  });
});
