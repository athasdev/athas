import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  authenticatedFetch,
  beginDesktopAuthSession,
  fetchSubscriptionStatus,
  isAuthInvalidError,
  waitForDesktopAuthToken,
} from "../services/auth-api";

const http = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: http }));
vi.mock("@/utils/api-base", () => ({
  getApiBase: () => "http://localhost:3000",
  isLocalApiBase: (url: string) => url.startsWith("http://localhost"),
}));

beforeEach(() => {
  http.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("desktop server isolation", () => {
  it.each([401, 403, 404, 500])(
    "does not send a rejected local session to production (%s)",
    async (status) => {
      http.mockResolvedValue(new Response(null, { status }));
      const response = await authenticatedFetch("/api/auth/me", {}, "local-test-token");
      expect(response.status).toBe(status);
      expect(http).toHaveBeenCalledOnce();
      expect(http.mock.calls[0][0]).toBe("http://localhost:3000/api/auth/me");
    },
  );

  it("reads a missing sign-in session from a 404 body instead of calling the endpoint gone", async () => {
    http.mockResolvedValue(Response.json({ status: "missing" }, { status: 404 }));
    await expect(waitForDesktopAuthToken("session", "secret")).rejects.toMatchObject({
      code: "failed",
    });
  });

  it("reads a missing sign-in session answered with 200", async () => {
    http.mockResolvedValue(Response.json({ status: "missing" }));
    await expect(waitForDesktopAuthToken("session", "secret")).rejects.toMatchObject({
      code: "failed",
    });
  });

  it("still reports an old server without the poll endpoint", async () => {
    http.mockResolvedValue(new Response("Not found", { status: 404 }));
    await expect(waitForDesktopAuthToken("session", "secret")).rejects.toMatchObject({
      code: "endpoint_unavailable",
    });
  });

  it("keeps the session on a plain 403 and drops it on a 403 marked invalid", async () => {
    http.mockResolvedValueOnce(Response.json({ error: "Not on this plan" }, { status: 403 }));
    const permission = await fetchSubscriptionStatus("token").catch((error) => error);
    expect(isAuthInvalidError(permission)).toBe(false);

    http.mockResolvedValueOnce(Response.json({ code: "session_revoked" }, { status: 403 }));
    const revoked = await fetchSubscriptionStatus("token").catch((error) => error);
    expect(isAuthInvalidError(revoked)).toBe(true);
  });

  it("applies a caller timeout alongside the caller's own signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    http.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const controller = new AbortController();
    const request = authenticatedFetch(
      "/api/browser-use/run",
      { signal: controller.signal, timeoutMs: 60_000 },
      "token",
    );
    await Promise.resolve();
    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(http.mock.calls[0][1]).not.toHaveProperty("timeoutMs");
    controller.abort();
    await expect(request).rejects.toThrow("aborted");

    http.mockResolvedValue(new Response(null, { status: 200 }));
    timeout.mockClear();
    await authenticatedFetch("/api/auth/me", {}, "token");
    expect(timeout).toHaveBeenCalledWith(10_000);
    timeout.mockRestore();
  });

  it("reports the local server address when sign-in is unavailable", async () => {
    http.mockRejectedValue(new Error("Connection refused"));
    await expect(beginDesktopAuthSession()).rejects.toThrow("http://localhost:3000");
    expect(http).toHaveBeenCalledOnce();
  });

  it("keeps a missing local sign-in endpoint on the local server", async () => {
    http.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(beginDesktopAuthSession()).rejects.toThrow("unavailable on this server");
    expect(http).toHaveBeenCalledOnce();
  });

  it("stops polling immediately when a pending sign-in is canceled", async () => {
    vi.useFakeTimers();
    http.mockImplementation(async () => Response.json({ status: "pending" }));
    const controller = new AbortController();
    const request = waitForDesktopAuthToken("session", "secret", 30000, {
      signal: controller.signal,
    });
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(30000);
    expect(http).toHaveBeenCalledOnce();
  });

  it("backs off while the browser is pending and returns the completed token", async () => {
    vi.useFakeTimers();
    http.mockImplementation(async () => Response.json({ status: "pending" }));
    const request = waitForDesktopAuthToken("session", "secret", 30000);
    await vi.advanceTimersByTimeAsync(1500);
    expect(http).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(http).toHaveBeenCalledTimes(2);
    http.mockImplementation(async () => Response.json({ status: "ready", token: "desktop-token" }));
    await vi.advanceTimersByTimeAsync(750);
    expect(await request).toBe("desktop-token");
    expect(http).toHaveBeenCalledTimes(3);
  });
});
