import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const http = vi.hoisted(() => ({ fetch: vi.fn(), token: vi.fn() }));

vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: http.fetch }));
vi.mock("@/features/auth/services/auth-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/services/auth-api")>()),
  getAuthToken: http.token,
}));
vi.mock("@/utils/api-base", () => ({ getApiBase: () => "https://athas.dev" }));

import {
  fetchIntelligenceSettings,
  IntelligenceSettingsError,
} from "../intelligence/services/intelligence-settings-api";

const settings = { scope: "personal", scopes: [], revision: 3, preferences: {} };

beforeEach(() => {
  http.fetch.mockReset();
  http.token.mockReset().mockResolvedValue("token");
});

describe("fetchIntelligenceSettings", () => {
  it("returns the settings for the requested scope", async () => {
    http.fetch.mockResolvedValue(Response.json(settings));

    await expect(fetchIntelligenceSettings("personal")).resolves.toMatchObject({
      scope: "personal",
      revision: 3,
    });
    expect(http.fetch.mock.calls[0][0]).toBe(
      "https://athas.dev/api/account/intelligence?scope=personal",
    );
  });

  it("asks for sign-in before requesting anything", async () => {
    http.token.mockResolvedValue(null);

    await expect(fetchIntelligenceSettings("personal")).rejects.toMatchObject({
      message: "Sign in to sync your AI settings.",
      status: 401,
    });
    expect(http.fetch).not.toHaveBeenCalled();
  });

  it("reports the server's error message and status", async () => {
    http.fetch.mockResolvedValue(
      Response.json({ error: "Team settings are locked." }, { status: 403 }),
    );

    await expect(fetchIntelligenceSettings("team:4")).rejects.toMatchObject({
      message: "Team settings are locked.",
      status: 403,
    });
  });

  it("keeps the status when an outage page is not JSON", async () => {
    http.fetch.mockResolvedValue(
      new Response("<html>Bad gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const error = await fetchIntelligenceSettings("personal").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(IntelligenceSettingsError);
    expect(error).toMatchObject({ message: "Could not sync your AI settings.", status: 502 });
  });

  it("rejects a successful response that is not settings", async () => {
    http.fetch.mockResolvedValue(new Response("<html>Sign in</html>", { status: 200 }));

    await expect(fetchIntelligenceSettings("personal")).rejects.toMatchObject({
      message: "Athas returned invalid AI settings.",
      status: 502,
    });
  });
});
