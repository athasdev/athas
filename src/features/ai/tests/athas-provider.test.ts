import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getApiErrorCode } from "../lib/api-error";
import { AthasProvider } from "../services/providers/athas-provider";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  plan: "free" as "pro" | "free",
}));
vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: state.fetch }));
vi.mock("@/features/auth/services/auth-api", () => ({ getAuthToken: async () => "token" }));
vi.mock("@/utils/api-base", () => ({ getApiBase: () => "https://api.test" }));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ user: { id: 1 }, subscription: { status: state.plan } }) },
}));
vi.mock("@/features/ai/intelligence/stores/intelligence-settings.store", () => ({
  useIntelligenceSettingsStore: { getState: () => ({ scope: "personal" }) },
}));

const provider = () =>
  new AthasProvider({
    id: "athas",
    name: "Athas",
    apiUrl: "",
    requiresApiKey: false,
    models: [],
  } as never);

beforeEach(() => {
  state.fetch.mockReset();
  state.plan = "free";
});

describe("Athas hosted models", () => {
  it("asks a user without Pro or balance to upgrade or top up", async () => {
    state.fetch.mockResolvedValue(Response.json({ enabled: false, data: [] }));
    const error = await provider()
      .getModels()
      .catch((caught: unknown) => caught);
    expect(String(error)).toContain("Upgrade or add credit");
    expect(getApiErrorCode(error as Error)).toBe("402");
  });

  it("says the server is off when a Pro account still gets no models", async () => {
    state.plan = "pro";
    state.fetch.mockResolvedValue(Response.json({ enabled: false, data: [] }));
    await expect(provider().getModels()).rejects.toThrow("not available on this Athas server");
  });

  it("asks for the model's own output limit instead of a fixed 4096", () => {
    const request = {
      modelId: "anthropic/claude-sonnet-5",
      messages: [],
      maxTokens: 32000,
      temperature: 0.2,
    } as never;
    expect(provider().buildPayload(request)).toMatchObject({ max_completion_tokens: 32000 });
    expect(
      provider().buildPayload({ ...(request as object), maxTokens: Number.NaN } as never),
    ).not.toHaveProperty("max_completion_tokens");
  });
});
