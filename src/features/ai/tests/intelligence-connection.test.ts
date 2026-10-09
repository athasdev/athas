import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), token: vi.fn() }));

vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: mocks.fetch }));
vi.mock("@/features/auth/services/auth-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth-api")>()),
  getAuthToken: mocks.token,
}));

import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  AutocompleteModelRequiredError,
  getIntelligenceConnection,
} from "../intelligence/services/intelligence-connection";
import {
  IntelligenceSettingsError,
  fetchIntelligenceSettings,
} from "../intelligence/services/intelligence-settings-api";
import { useIntelligenceSettingsStore } from "../intelligence/stores/intelligence-settings.store";

const initialSettings = useSettingsStore.getState().settings;

function snapshot(scope: string, preferences: unknown, revision = 1) {
  return new Response(
    JSON.stringify({
      scope,
      scopes: [{ id: "personal", name: "Personal", canEdit: true }],
      preferences,
      revision,
      updatedAt: null,
    }),
    { status: 200 },
  );
}

function signIn(id: number, capabilities?: Record<string, boolean>) {
  useAuthStore.setState({
    user: { id } as never,
    isAuthenticated: true,
    subscription: capabilities ? ({ capabilities } as never) : null,
  });
}

let nextUserId = 100;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockResolvedValue("session-token");
  useSettingsStore.setState({
    settings: { ...initialSettings, aiProviderId: "anthropic", aiModelId: "claude-sonnet-5" },
  });
  useAuthStore.setState({ user: null, isAuthenticated: false, subscription: null });
});

describe("getIntelligenceConnection", () => {
  it("uses the personal model on Automatic without Athas access", async () => {
    const connection = await getIntelligenceConnection("agent");
    expect(connection).toEqual({
      providerId: "anthropic",
      modelId: "claude-sonnet-5",
      scope: "personal",
      userId: null,
    });
  });

  it("uses the synced task choice of a signed-in account", async () => {
    const userId = nextUserId++;
    signIn(userId, { intelligence: true });
    mocks.fetch.mockResolvedValue(
      snapshot("personal", {
        defaultConnection: { providerId: "auto", modelId: "" },
        tasks: { "commit-message": { providerId: "openai", modelId: "gpt-5.6-luna" } },
        autoRouting: true,
      }),
    );

    expect(await getIntelligenceConnection("commit-message")).toEqual({
      providerId: "openai",
      modelId: "gpt-5.6-luna",
      scope: "personal",
      userId,
    });
    expect(await getIntelligenceConnection("agent")).toMatchObject({
      providerId: "athas",
      modelId: "auto",
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/account\/intelligence\?scope=personal$/);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
  });

  it("explains how to turn on Tab completion when nothing can run it", async () => {
    useSettingsStore.setState({
      settings: { ...initialSettings, aiProviderId: "athas", aiModelId: "" },
    });
    const signedOut = await getIntelligenceConnection("autocomplete").catch((error) => error);
    expect(signedOut).toBeInstanceOf(AutocompleteModelRequiredError);
    expect(signedOut.message).toBe(
      "Sign in to use Athas for Tab completion, or choose a model for it in Settings.",
    );

    signIn(nextUserId++);
    mocks.fetch.mockResolvedValue(
      snapshot("personal", { defaultConnection: { providerId: "auto", modelId: "" }, tasks: {} }),
    );
    const signedIn = await getIntelligenceConnection("autocomplete").catch((error) => error);
    expect(signedIn).toBeInstanceOf(AutocompleteModelRequiredError);
    expect(signedIn.message).toBe("Choose a model for Tab completion in Settings.");
  });

  it("keeps Tab completion on a local Ollama model", async () => {
    useSettingsStore.setState({
      settings: {
        ...initialSettings,
        aiProviderId: "ollama",
        aiModelId: "qwen2.5-coder",
        ollamaBaseUrl: "http://localhost:11434",
      },
    });
    signIn(nextUserId++, { intelligence: true });
    mocks.fetch.mockResolvedValue(
      snapshot("personal", { defaultConnection: { providerId: "auto", modelId: "" }, tasks: {} }),
    );

    expect(await getIntelligenceConnection("autocomplete")).toMatchObject({
      providerId: "ollama",
      modelId: "qwen2.5-coder",
    });
  });

  it("refuses connections the organization disabled", async () => {
    signIn(nextUserId++);
    useAuthStore.setState({
      subscription: {
        enterprise: {
          policy: {
            managedMode: true,
            aiChatEnabled: true,
            aiCompletionEnabled: false,
            allowByok: false,
          },
        },
      } as never,
    });
    mocks.fetch.mockResolvedValue(
      snapshot("personal", {
        defaultConnection: { providerId: "openai", modelId: "gpt-5.6-sol" },
        tasks: { autocomplete: { providerId: "athas", modelId: "" } },
      }),
    );

    await expect(getIntelligenceConnection("agent")).rejects.toThrow(
      "This AI connection is disabled by your organization.",
    );
    await expect(getIntelligenceConnection("autocomplete")).rejects.toThrow(
      "This AI connection is disabled by your organization.",
    );
  });

  it("fails when the account switches while settings load", async () => {
    const userId = nextUserId++;
    signIn(userId);
    mocks.token.mockImplementation(async () => {
      useAuthStore.setState({ user: { id: userId + 1000 } as never });
      return "session-token";
    });

    await expect(getIntelligenceConnection("agent")).rejects.toThrow(
      "The active account changed. Try again.",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses to fall back silently when team settings are unavailable", async () => {
    const userId = nextUserId++;
    signIn(userId);
    mocks.fetch.mockResolvedValue(
      snapshot("personal", { defaultConnection: { providerId: "auto", modelId: "" }, tasks: {} }),
    );
    await getIntelligenceConnection("agent");
    useIntelligenceSettingsStore.setState({ scope: "team:4", error: "Team settings failed." });

    await expect(getIntelligenceConnection("agent")).rejects.toThrow(
      "Team settings are unavailable. Select personal settings or reconnect.",
    );
    useIntelligenceSettingsStore.setState({ scope: "personal", error: null });
  });

  it("waits for an in-flight settings load before resolving", async () => {
    const userId = nextUserId++;
    signIn(userId);
    mocks.fetch.mockResolvedValue(
      snapshot("personal", { defaultConnection: { providerId: "auto", modelId: "" }, tasks: {} }),
    );
    await getIntelligenceConnection("agent");
    useIntelligenceSettingsStore.setState({ loading: true });

    const pending = getIntelligenceConnection("agent");
    setTimeout(() => {
      useIntelligenceSettingsStore.setState({
        loading: false,
        preferences: {
          defaultConnection: { providerId: "mistral", modelId: "mistral-medium-3-5" },
          tasks: {},
          autoRouting: true,
        },
      });
    }, 0);

    expect(await pending).toMatchObject({ providerId: "mistral", modelId: "mistral-medium-3-5" });
  });
});

describe("fetchIntelligenceSettings", () => {
  it("asks the user to sign in without a session", async () => {
    mocks.token.mockResolvedValue(null);
    const error = await fetchIntelligenceSettings("personal").catch((reason) => reason);
    expect(error).toBeInstanceOf(IntelligenceSettingsError);
    expect(error).toMatchObject({ status: 401, message: "Sign in to sync your AI settings." });
  });

  it("saves preferences with the current revision", async () => {
    mocks.fetch.mockResolvedValue(
      snapshot(
        "team:2",
        {
          defaultConnection: { providerId: "openai", modelId: " gpt-5.6-sol " },
          tasks: {},
        },
        8,
      ),
    );
    const preferences = {
      defaultConnection: { providerId: "openai", modelId: "gpt-5.6-sol" },
      tasks: {},
      autoRouting: true,
    };

    const result = await fetchIntelligenceSettings("team:2", { revision: 7, preferences });

    expect(result.revision).toBe(8);
    expect(result.preferences.defaultConnection).toEqual({
      providerId: "openai",
      modelId: "gpt-5.6-sol",
    });
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/scope=team%3A2$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ scope: "team:2", revision: 7, preferences });
  });

  it("surfaces the server error message and status", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Revision conflict" }), { status: 409 }),
    );
    await expect(fetchIntelligenceSettings("personal")).rejects.toMatchObject({
      status: 409,
      message: "Revision conflict",
    });

    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));
    await expect(fetchIntelligenceSettings("personal")).rejects.toMatchObject({
      status: 500,
      message: "Could not sync your AI settings.",
    });
  });

  it("rejects responses for another scope or with a bad revision", async () => {
    mocks.fetch.mockResolvedValue(snapshot("team:9", {}));
    await expect(fetchIntelligenceSettings("personal")).rejects.toMatchObject({
      status: 502,
      message: "Athas returned invalid AI settings.",
    });

    mocks.fetch.mockResolvedValue(snapshot("personal", {}, -1));
    await expect(fetchIntelligenceSettings("personal")).rejects.toMatchObject({ status: 502 });
  });

  it("rejects the request when the account changed before sending", async () => {
    signIn(1);
    await expect(fetchIntelligenceSettings("personal", undefined, 2)).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
