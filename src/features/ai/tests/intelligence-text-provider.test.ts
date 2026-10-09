import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  token: vi.fn(),
  connection: vi.fn(),
}));

vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: mocks.fetch }));
vi.mock("@/features/auth/services/auth-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth-api")>()),
  getAuthToken: mocks.token,
}));
vi.mock("@/features/ai/intelligence/services/intelligence-connection", () => ({
  getIntelligenceConnection: mocks.connection,
  assertIntelligenceConnectionAllowed: () => {},
}));

import { enableMapSet } from "immer";
import { commands } from "@/bindings/commands";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  registerAIProviderExtension,
  unregisterAIProviderExtension,
} from "@/features/ai/services/providers/ai-provider-registry";
import { OpenAICompatibleProvider } from "@/features/ai/services/providers/openai-compatible-provider";
import { useAIChatStore } from "../stores/ai-chat.store";
import {
  InlineEditError,
  requestInlineEdit,
} from "../intelligence/services/intelligence-text-service";

enableMapSet();

const extensionId = "test.ai.inline";
const browserFetch = vi.fn();
const initialSettings = useSettingsStore.getState().settings;

function sse(chunks: string[]) {
  return new Response(
    [
      ...chunks.map(
        (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
      ),
      "data: [DONE]\n\n",
    ].join(""),
  );
}

function register(options: { requiresApiKey?: boolean; useTauriFetch?: boolean } = {}) {
  registerAIProviderExtension({
    extensionId,
    provider: {
      id: "acme",
      name: "Acme",
      apiUrl: "https://acme.test/v1/chat/completions",
      requiresApiKey: options.requiresApiKey ?? true,
      models: [{ id: "acme-small", name: "Acme Small", maxTokens: 1000 }],
    },
    createProvider: (config) => new OpenAICompatibleProvider(config),
    useTauriFetch: options.useTauriFetch ?? false,
  });
}

const select = { beforeSelection: "const a = ", selectedText: "1", afterSelection: ";" };

async function failure(promise: Promise<unknown>) {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(InlineEditError);
  return error as InlineEditError;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue({
    providerId: "acme",
    modelId: "acme-small",
    userId: null,
    scope: "personal",
  });
  mocks.token.mockResolvedValue("session");
  useAuthStore.setState({ user: null });
  useSettingsStore.setState({ settings: { ...initialSettings } });
  useAIChatStore.setState({ dynamicModels: {} });
  vi.spyOn(commands, "getAiProviderToken").mockResolvedValue("acme-key");
  vi.stubGlobal("fetch", browserFetch);
});

afterEach(() => {
  unregisterAIProviderExtension(extensionId);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inline edits through an extension provider", () => {
  it("streams the replacement and strips a markdown fence", async () => {
    register();
    browserFetch.mockResolvedValue(sse(["```ts\n", "2", "\n```"]));

    const result = await requestInlineEdit({ model: "", ...select, instruction: " Use two " });

    expect(result).toEqual({ editedText: "2" });
    const [url, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://acme.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer acme-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "acme-small", max_tokens: 1000, temperature: 0.2 });
    expect(body.messages[0].content).toContain("Rewrite only the selected code");
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      instruction: "Use two",
      before: "const a = ",
      selection: "1",
      after: ";",
    });
  });

  it("caps autocomplete output and uses the Tauri client when asked", async () => {
    register({ useTauriFetch: true });
    mocks.fetch.mockResolvedValue(sse(["42"]));

    const result = await requestInlineEdit({
      feature: "autocomplete",
      model: "",
      ...select,
      relatedFiles: [{ filePath: "/b.ts", snippet: "export const b = 1;" }],
    });

    expect(result.editedText).toBe("42");
    expect(browserFetch).not.toHaveBeenCalled();
    const body = JSON.parse((mocks.fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(256);
    expect(JSON.parse(body.messages[1].content).relatedFiles).toEqual([
      { filePath: "/b.ts", snippet: "export const b = 1;" },
    ]);
  });

  it("uses a model from the fetched catalog", async () => {
    register();
    useAIChatStore.setState({ dynamicModels: { acme: [{ id: "acme-new", name: "Acme New" }] } });
    browserFetch.mockResolvedValue(sse(["ok"]));

    await requestInlineEdit({ provider: "acme", model: "acme-new", ...select });

    const body = JSON.parse((browserFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ model: "acme-new", max_tokens: 4096 });
  });

  it("asks for a model before calling the provider", async () => {
    register();
    mocks.connection.mockResolvedValue({
      providerId: "acme",
      modelId: "  ",
      userId: null,
      scope: "personal",
    });
    const error = await failure(requestInlineEdit({ model: "", ...select }));
    expect(error).toMatchObject({ status: 400, message: "Choose a model for this AI feature." });
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it("reports unknown providers and models", async () => {
    expect(
      await failure(requestInlineEdit({ provider: "nowhere", model: "x", ...select })),
    ).toMatchObject({ status: 400, message: "Provider not found: nowhere" });

    register();
    expect(
      await failure(requestInlineEdit({ provider: "acme", model: "ghost", ...select })),
    ).toMatchObject({ status: 400, message: "Model not found: acme/ghost" });
  });

  it("requires the provider's API key", async () => {
    register();
    vi.mocked(commands.getAiProviderToken).mockResolvedValue(null);
    expect(await failure(requestInlineEdit({ model: "", ...select }))).toMatchObject({
      status: 402,
      message: "Acme API key is required for inline edit.",
    });
  });

  it("sends keyless requests for providers that do not need a key", async () => {
    register({ requiresApiKey: false });
    vi.mocked(commands.getAiProviderToken).mockRejectedValue(new Error("no keychain"));
    browserFetch.mockResolvedValue(sse(["x"]));

    expect(await requestInlineEdit({ model: "", ...select })).toEqual({ editedText: "x" });
    expect((browserFetch.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it("surfaces the provider's error body and status", async () => {
    register();
    browserFetch.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    expect(await failure(requestInlineEdit({ model: "", ...select }))).toMatchObject({
      status: 429,
      message: "rate limited",
      hosted: false,
    });

    browserFetch.mockResolvedValueOnce(new Response("", { status: 503 }));
    expect(await failure(requestInlineEdit({ model: "", ...select }))).toMatchObject({
      status: 503,
      message: "Acme inline edit request failed (503)",
    });
  });

  it("surfaces errors reported inside the stream", async () => {
    register();
    browserFetch.mockResolvedValue(
      new Response(`data: ${JSON.stringify({ error: { code: 500, message: "boom" } })}\n\n`),
    );
    const error = await failure(requestInlineEdit({ model: "", ...select }));
    expect(error.status).toBe(500);
    expect(error.message).toContain("Streaming API error: 500 boom");
  });

  it("rejects a result when the account changed during the request", async () => {
    register();
    browserFetch.mockImplementation(async () => {
      useAuthStore.setState({ user: { id: 77 } as never });
      return sse(["late"]);
    });
    expect(await failure(requestInlineEdit({ model: "", ...select }))).toMatchObject({
      status: 409,
      message: "The active account or team changed. Try again.",
    });
  });
});

describe("hosted inline edits", () => {
  beforeEach(() => {
    mocks.connection.mockResolvedValue({
      providerId: "athas",
      modelId: "",
      userId: null,
      scope: "personal",
    });
  });

  it("asks the user to sign in without a session", async () => {
    mocks.token.mockResolvedValue(null);
    expect(await failure(requestInlineEdit({ model: "", ...select }))).toMatchObject({
      status: 401,
      message: "Sign in to use Athas AI.",
      hosted: true,
    });
  });

  it("refuses to send when the account changed while reading the session", async () => {
    mocks.token.mockImplementation(async () => {
      useAuthStore.setState({ user: { id: 5 } as never });
      return "session";
    });
    expect(await failure(requestInlineEdit({ model: "", ...select }))).toMatchObject({
      status: 409,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("sends the inline edit with the scope header and reads the edited text", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ editedText: "2" })));

    expect(await requestInlineEdit({ model: "", ...select })).toEqual({ editedText: "2" });

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/ai\/inline-edit$/);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer session",
      "X-Athas-Intelligence-Scope": "personal",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      provider: "athas",
      selectedText: "1",
      instruction: "Improve this code while preserving behavior.",
    });
  });

  it("falls back to a status message when the server error is not JSON", async () => {
    mocks.fetch.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await failure(requestInlineEdit({ model: "", ...select }))).toMatchObject({
      status: 502,
      message: "Inline edit request failed (502)",
      hosted: true,
    });
  });

  it("returns empty text for a malformed success body", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ editedText: 5 })));
    expect(await requestInlineEdit({ model: "", ...select })).toEqual({ editedText: "" });
  });

  it("discards a reply that arrives after the account changed", async () => {
    mocks.fetch.mockImplementation(async () => {
      useAuthStore.setState({ user: { id: 9 } as never });
      return new Response(JSON.stringify({ editedText: "2" }));
    });
    expect(await failure(requestInlineEdit({ model: "", ...select }))).toMatchObject({
      status: 409,
    });
  });
});
