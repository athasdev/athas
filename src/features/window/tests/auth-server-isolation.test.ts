import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  authenticatedFetch,
  beginDesktopAuthSession,
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
