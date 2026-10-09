import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  http: vi.fn(),
  getConnection: vi.fn(),
  runAgent: vi.fn(),
  teamContext: vi.fn(),
  acpStart: vi.fn(),
  acpCallbacks: [] as Array<Record<string, unknown>>,
  codexStart: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.http }));
vi.mock("@/features/workspace/team/services/workspace-team-context", () => ({
  loadWorkspaceTeamContext: mocks.teamContext,
}));
vi.mock("@/features/ai/intelligence/services/intelligence-connection", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/features/ai/intelligence/services/intelligence-connection")
    >();
  return { ...actual, getIntelligenceConnection: mocks.getConnection };
});
vi.mock("@/features/ai/intelligence/services/intelligence-agent", () => ({
  runIntelligenceAgent: mocks.runAgent,
}));
vi.mock("@/features/ai/services/acp-stream-handler", () => ({
  AcpStreamHandler: class {
    constructor(
      readonly agentId: string,
      callbacks: Record<string, unknown>,
      readonly chatId?: string,
    ) {
      mocks.acpCallbacks.push(callbacks);
    }
    start(message: string, context: unknown) {
      return mocks.acpStart(this.agentId, message, context, this.chatId);
    }
  },
}));
vi.mock("@/features/ai/integrations/codex/codex-integration-service", () => ({
  CodexIntegrationService: class {
    start(prompt: string, context: unknown) {
      return mocks.codexStart(prompt, context);
    }
  },
}));

import { commands } from "@/bindings/commands";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { getChatCompletionStream, isAcpAgent } from "@/features/ai/services/ai-chat-service";
import {
  getProvider,
  registerAIProviderExtension,
  unregisterAIProviderExtension,
} from "@/features/ai/services/providers/ai-provider-registry";
import { OpenAICompatibleProvider } from "@/features/ai/services/providers/openai-compatible-provider";
import type { ContextInfo } from "@/features/ai/types/ai-context.types";
import type { Settings } from "@/features/settings/types/settings.types";

const browserFetch = vi.fn();
const initialSettings = useSettingsStore.getState().settings;
const tokens = new Map<string, string>();

function setSettings(patch: Partial<Settings>) {
  useSettingsStore.setState({ settings: { ...initialSettings, ...patch } });
}

function sseResponse(events: string[], status = 200) {
  return new Response(events.map((event) => `data: ${event}\n\n`).join(""), { status });
}

interface RunOptions {
  agentId?: string;
  providerId?: string;
  modelId?: string;
  message?: string;
  context?: ContextInfo;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  mode?: "chat" | "plan" | "ask";
  chatId?: string;
  systemPromptOverride?: string;
}

async function run(options: RunOptions = {}) {
  const chunks: string[] = [];
  const errors: string[] = [];
  const completions: unknown[] = [];
  await getChatCompletionStream(
    (options.agentId ?? "custom") as never,
    options.providerId ?? "athas",
    options.modelId ?? "auto",
    options.message ?? "Explain this",
    options.context ?? {},
    (chunk) => chunks.push(chunk),
    (result) => completions.push(result),
    (error) => errors.push(error),
    options.history,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    options.mode ?? "chat",
    "default",
    undefined,
    undefined,
    options.chatId,
    options.systemPromptOverride,
  );
  return { chunks, errors, completions, text: chunks.join("") };
}

function agentInput() {
  expect(mocks.runAgent).toHaveBeenCalledTimes(1);
  return mocks.runAgent.mock.calls[0][0] as {
    sessionId: string;
    providerId: string;
    modelId: string;
    messages: Array<{ role: string; content: string }>;
    readOnly: boolean;
    maxOutputTokens?: number;
    notices: string[];
  };
}

const extensionId = "test.ai.acme";

function registerAcme(useTauriFetch: boolean, extras: { systemPrompt?: string } = {}) {
  registerAIProviderExtension({
    extensionId,
    provider: {
      id: "acme",
      name: "Acme AI",
      apiUrl: "https://acme.test/v1/chat/completions",
      requiresApiKey: true,
      models: [{ id: "acme-1", name: "Acme One", maxOutputTokens: 2048 }],
    },
    createProvider: (config) => new OpenAICompatibleProvider(config),
    useTauriFetch,
    ...(extras.systemPrompt ? { buildSystemPromptContext: () => extras.systemPrompt! } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acpCallbacks.length = 0;
  tokens.clear();
  setSettings({});
  useAuthStore.setState({ subscription: null });
  mocks.getConnection.mockResolvedValue({ providerId: "athas", modelId: "auto" });
  mocks.runAgent.mockResolvedValue({ outcome: "completed", steps: 1 });
  mocks.teamContext.mockResolvedValue(null);
  vi.spyOn(commands, "getAiProviderToken").mockImplementation(
    async (providerId: string) => tokens.get(providerId) ?? null,
  );
  vi.stubGlobal("fetch", browserFetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  unregisterAIProviderExtension(extensionId);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isAcpAgent", () => {
  it("treats every agent except the built-in and Codex as ACP", () => {
    expect(isAcpAgent("claude-code" as never)).toBe(true);
    expect(isAcpAgent("custom" as never)).toBe(false);
    expect(isAcpAgent("codex" as never)).toBe(false);
  });
});

describe("built-in agent requests", () => {
  it("runs the Athas agent with the system prompt, history and user message", async () => {
    mocks.runAgent.mockResolvedValue({ outcome: "completed", steps: 2 });

    const { completions, errors } = await run({
      message: "Fix the bug",
      history: [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
      ],
      chatId: "chat-1",
    });

    expect(errors).toEqual([]);
    expect(completions).toEqual([{ outcome: "completed", steps: 2 }]);
    const input = agentInput();
    expect(input.sessionId).toBe("chat-1");
    expect(input.providerId).toBe("athas");
    expect(input.modelId).toBe("auto");
    expect(input.readOnly).toBe(false);
    expect(input.maxOutputTokens).toEqual(expect.any(Number));
    expect(input.messages[0].role).toBe("system");
    expect(input.messages[0].content).toContain("CHAT MODE");
    expect(input.messages.slice(1)).toEqual([
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Fix the bug" },
    ]);
  });

  it("runs read-only outside chat mode and honors a system prompt override", async () => {
    await run({ mode: "plan", systemPromptOverride: "Only plan." });
    const input = agentInput();
    expect(input.readOnly).toBe(true);
    expect(input.messages[0]).toEqual({ role: "system", content: "Only plan." });
    expect(input.sessionId).toEqual(expect.any(String));
  });

  it("adds team instructions and user rules to the system prompt", async () => {
    mocks.teamContext.mockResolvedValue({ instructions: "Use tabs." });
    setSettings({ aiUserRules: "Always answer in English." });

    await run({ context: { projectRoot: "/nonexistent/athas-test-project" } });

    expect(mocks.teamContext).toHaveBeenCalledWith("/nonexistent/athas-test-project");
    const system = agentInput().messages[0].content;
    expect(system).toContain("Team workspace instructions");
    expect(system).toContain("Use tabs.");
    expect(system).toContain("Project: athas-test-project");
  });

  it("does not send an Athas-only output budget to BYOK providers", async () => {
    tokens.set("anthropic", "sk-ant");
    await run({ providerId: "anthropic", modelId: "claude-sonnet-5" });
    const input = agentInput();
    expect(input.providerId).toBe("anthropic");
    expect(input).not.toHaveProperty("maxOutputTokens");
  });

  it("reports a missing API key without calling the provider", async () => {
    const { errors } = await run({ providerId: "openai", modelId: "gpt-5.6-sol" });
    expect(errors).toEqual(["Failed to connect to openai API: OpenAI API key not found"]);
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("asks for a custom model and base URL before sending", async () => {
    expect((await run({ providerId: "custom", modelId: "" })).errors).toEqual([
      "Failed to connect to custom API: Custom provider model is required. Add one in Settings -> Agent.",
    ]);

    setSettings({ aiCustomModelId: "local-llama", aiCustomBaseUrl: "" });
    expect((await run({ providerId: "custom", modelId: "" })).errors).toEqual([
      "Failed to connect to custom API: Custom provider base URL is required. Add one in Settings -> Agent.",
    ]);
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("points the custom provider at the configured base URL", async () => {
    setSettings({ aiCustomModelId: "local-llama", aiCustomBaseUrl: "http://127.0.0.1:8080/v1/" });
    tokens.set("autocomplete-custom", "custom-key");

    const { errors } = await run({ providerId: "custom", modelId: "" });

    expect(errors).toEqual([]);
    expect(agentInput().modelId).toBe("local-llama");
    expect((getProvider("custom") as OpenAICompatibleProvider).buildUrl()).toBe(
      "http://127.0.0.1:8080/v1/chat/completions",
    );
  });

  it("requires an API key for Ollama Cloud but not for local Ollama", async () => {
    setSettings({ ollamaBaseUrl: "https://ollama.com" });
    expect((await run({ providerId: "ollama", modelId: "gpt-oss:120b" })).errors).toEqual([
      "Failed to connect to ollama API: Ollama Cloud requires an API key. Add one in Settings -> Agent -> Ollama.",
    ]);

    setSettings({ ollamaBaseUrl: "http://localhost:11434" });
    expect((await run({ providerId: "ollama", modelId: "llama3" })).errors).toEqual([]);
    expect(agentInput().providerId).toBe("ollama");
  });

  it("blocks bring-your-own-key providers when the organization forbids them", async () => {
    tokens.set("openai", "sk");
    useAuthStore.setState({
      subscription: {
        enterprise: { policy: { managedMode: true, aiChatEnabled: true, allowByok: false } },
      } as never,
    });

    const { errors } = await run({ providerId: "openai", modelId: "gpt-5.6-sol" });

    expect(errors).toEqual([
      "Failed to connect to openai API: This AI connection is disabled by your organization.",
    ]);
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("surfaces HTTP status and body from agent failures", async () => {
    mocks.runAgent.mockRejectedValue(
      Object.assign(new Error("Too many requests"), {
        statusCode: 429,
        responseBody: '{"error":{"message":"slow down"}}',
      }),
    );

    expect((await run()).errors).toEqual([
      'athas API error: 429|||{"error":{"message":"slow down"}}',
    ]);
  });

  it("surfaces connection resolution failures", async () => {
    mocks.getConnection.mockRejectedValue(new Error("The active account changed. Try again."));
    expect((await run()).errors).toEqual([
      "Failed to connect to athas API: The active account changed. Try again.",
    ]);
  });

  it("drops images for a text-only Athas model and tells the agent why", async () => {
    await run({
      modelId: "minimax/m3",
      context: { images: [{ data: "AAAA", mediaType: "image/png" }] as never },
    });
    const input = agentInput();
    expect(input.notices).toEqual([
      "An image was not sent: MiniMax M3 cannot read images. Choose a model that supports images to include them.",
    ]);
    expect(input.messages[input.messages.length - 1]).not.toHaveProperty("images");
  });

  it("reports an unknown provider", async () => {
    expect((await run({ providerId: "nope", modelId: "x" })).errors).toEqual([
      "Failed to connect to nope API: Provider or model not found: nope/x",
    ]);
  });
});

describe("extension provider HTTP streaming", () => {
  it("posts the built request through browser fetch and streams the answer", async () => {
    registerAcme(false, { systemPrompt: "Acme house style." });
    tokens.set("acme", "acme-key");
    browserFetch.mockResolvedValue(
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hello " } }] }),
        JSON.stringify({ choices: [{ delta: { content: "there" } }] }),
        "[DONE]",
      ]),
    );

    const result = await run({ providerId: "acme", modelId: "acme-1", message: "Hi" });

    expect(result.errors).toEqual([]);
    expect(result.text).toBe("Hello there");
    expect(result.completions).toHaveLength(1);
    expect(mocks.http).not.toHaveBeenCalled();
    const [url, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://acme.test/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer acme-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "acme-1", stream: true, temperature: 0.7 });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages[0].content).toContain("Acme house style.");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Hi" });
  });

  it("uses the Tauri HTTP client when the provider asks for it", async () => {
    registerAcme(true);
    tokens.set("acme", "acme-key");
    mocks.http.mockResolvedValue(
      sseResponse([JSON.stringify({ choices: [{ delta: { content: "ok" } }] }), "[DONE]"]),
    );

    const result = await run({ providerId: "acme", modelId: "acme-1" });

    expect(result.text).toBe("ok");
    expect(browserFetch).not.toHaveBeenCalled();
    expect(mocks.http.mock.calls[0][0]).toBe("https://acme.test/v1/chat/completions");
  });

  it("reports the provider status and error body on HTTP failures", async () => {
    registerAcme(false);
    tokens.set("acme", "acme-key");
    browserFetch.mockResolvedValue(
      new Response('{"error":{"message":"invalid key"}}', { status: 401 }),
    );

    const result = await run({ providerId: "acme", modelId: "acme-1" });

    expect(result.errors).toEqual(['Acme AI API error: 401|||{"error":{"message":"invalid key"}}']);
    expect(result.completions).toEqual([]);
  });

  it("reports streamed provider errors", async () => {
    registerAcme(false);
    tokens.set("acme", "acme-key");
    browserFetch.mockResolvedValue(
      sseResponse([JSON.stringify({ error: { code: "overloaded", message: "Try later" } })]),
    );

    const result = await run({ providerId: "acme", modelId: "acme-1" });

    expect(result.errors).toEqual([
      'Streaming API error: overloaded Try later|||{"code":"overloaded","message":"Try later"}',
    ]);
  });

  it("reports network failures as connection errors", async () => {
    registerAcme(false);
    tokens.set("acme", "acme-key");
    browserFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    expect((await run({ providerId: "acme", modelId: "acme-1" })).errors).toEqual([
      "Failed to connect to acme API: Failed to fetch",
    ]);
  });

  it("sends attached images in the OpenAI image format", async () => {
    registerAcme(false);
    tokens.set("acme", "acme-key");
    browserFetch.mockResolvedValue(
      sseResponse([JSON.stringify({ choices: [{ delta: { content: "A cat" } }] }), "[DONE]"]),
    );

    const result = await run({
      providerId: "acme",
      modelId: "acme-1",
      context: { images: [{ data: "AAAA", mediaType: "image/png" }] as never },
    });

    expect(result.text).toBe("A cat");
    const body = JSON.parse((browserFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages.at(-1).content).toEqual([
      { type: "text", text: "Explain this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ]);
  });
});

describe("ACP and Codex routing", () => {
  it("hands ACP agents the raw message and context", async () => {
    mocks.acpStart.mockResolvedValue(undefined);
    await run({
      agentId: "claude-code",
      message: "Refactor",
      context: { projectRoot: "/repo" },
      chatId: "c1",
    });

    expect(mocks.acpStart).toHaveBeenCalledWith(
      "claude-code",
      "Refactor",
      expect.objectContaining({ projectRoot: "/repo", teamInstructions: undefined }),
      "c1",
    );
    expect(mocks.runAgent).not.toHaveBeenCalled();
    expect(mocks.acpCallbacks[0]).toHaveProperty("onChunk");
  });

  it("surfaces ACP start failures", async () => {
    mocks.acpStart.mockRejectedValue(new Error("Agent binary not found"));
    expect((await run({ agentId: "claude-code", providerId: "claude-code" })).errors).toEqual([
      "Failed to connect to claude-code API: Agent binary not found",
    ]);
  });

  it("prefixes the Codex prompt with workspace context", async () => {
    mocks.teamContext.mockResolvedValue({ instructions: "Team rule" });
    mocks.codexStart.mockResolvedValue(undefined);

    await run({ agentId: "codex", message: "Ship it", context: { projectRoot: "/repo/app" } });

    const [prompt] = mocks.codexStart.mock.calls[0] as [string];
    expect(prompt).toContain("Team rule");
    expect(prompt).toContain("Project: app");
    expect(prompt.endsWith("User request:\nShip it")).toBe(true);
  });

  it("sends Codex the bare message when there is no context", async () => {
    mocks.codexStart.mockResolvedValue(undefined);
    await run({ agentId: "codex", message: "Ship it" });
    expect(mocks.codexStart.mock.calls[0][0]).toBe("Ship it");
  });
});
