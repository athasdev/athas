import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { requestUIExtensionGeneration } from "../ui/services/ui-extension-generation-service";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  plan: "pro" as "pro" | "free",
}));
vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: state.fetch }));
vi.mock("@/features/auth/services/auth-api", () => ({ getAuthToken: async () => "token" }));
vi.mock("@/utils/api-base", () => ({ getApiBase: () => "https://api.test" }));
vi.mock("@/features/auth/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ subscription: { status: state.plan } }) },
}));

const request = () =>
  requestUIExtensionGeneration({ contributionType: "sidebar", description: "Release health" });

beforeEach(() => {
  state.fetch.mockReset();
  state.plan = "pro";
});

describe("UI extension generation failures", () => {
  it("tells a Pro user their included usage is used up instead of offering Pro", async () => {
    state.fetch.mockResolvedValue(Response.json({ error: "Allowance used" }, { status: 402 }));
    await expect(request()).rejects.toThrow("included Athas AI credit is used up");
  });

  it("offers Pro to a free user", async () => {
    state.plan = "free";
    state.fetch.mockResolvedValue(Response.json({}, { status: 402 }));
    await expect(request()).rejects.toThrow("included with Athas Pro");
  });

  it("gives the request a timeout and explains when it expires", async () => {
    state.fetch.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(request()).rejects.toMatchObject({ status: 408 });
    expect(state.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
