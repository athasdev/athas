import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const tauriFetch = vi.hoisted(() => vi.fn());

vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch }));

import { commands } from "@/bindings/commands";
import {
  AuthApiError,
  authenticatedFetch,
  beginDesktopAuthSession,
  fetchCurrentUser,
  fetchSubscriptionStatus,
  getAuthToken,
  isAuthInvalidError,
  logoutFromServer,
  removeAuthToken,
  storeAuthToken,
  updateEnterprisePolicy,
  waitForDesktopAuthToken,
} from "../services/auth-api";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastRequest() {
  const [url, init] = tauriFetch.mock.calls[tauriFetch.mock.calls.length - 1] as [
    string,
    RequestInit & { headers: Record<string, string> },
  ];
  return { url, init };
}

beforeEach(async () => {
  tauriFetch.mockReset();
  vi.spyOn(commands, "storeAuthToken").mockResolvedValue(null);
  vi.spyOn(commands, "removeAuthToken").mockResolvedValue(null);
  await storeAuthToken("saved-token");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("auth token storage", () => {
  it("caches stored tokens and forgets removed ones", async () => {
    const read = vi.spyOn(commands, "getAuthToken").mockResolvedValue("keychain-token");

    await expect(getAuthToken()).resolves.toBe("saved-token");
    await removeAuthToken();
    await expect(getAuthToken()).resolves.toBeNull();

    expect(read).not.toHaveBeenCalled();
    expect(commands.removeAuthToken).toHaveBeenCalledOnce();
  });

  it("does not cache a token the keychain failed to store", async () => {
    vi.mocked(commands.storeAuthToken).mockRejectedValueOnce(new Error("keychain locked"));

    await expect(storeAuthToken("new-token")).rejects.toThrow("keychain locked");
    await expect(getAuthToken()).resolves.toBe("saved-token");
  });

  it("reads the keychain once on first use and treats failures as signed out", async () => {
    vi.resetModules();
    const fresh = await import("../services/auth-api");
    const { commands: freshCommands } = await import("@/bindings/commands");
    const read = vi
      .spyOn(freshCommands, "getAuthToken")
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce("keychain-token");

    await expect(fresh.getAuthToken()).resolves.toBeNull();
    await expect(fresh.getAuthToken()).resolves.toBe("keychain-token");
    await expect(fresh.getAuthToken()).resolves.toBe("keychain-token");
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("authenticatedFetch", () => {
  it("sends the saved token and merges headers", async () => {
    tauriFetch.mockResolvedValue(json({}));

    await authenticatedFetch("/api/test", { method: "POST", headers: { "X-Extra": "1" } });

    const { url, init } = lastRequest();
    expect(url).toMatch(/\/api\/test$/);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer saved-token",
      "X-Extra": "1",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("prefers an explicit token and can disable the timeout", async () => {
    tauriFetch.mockResolvedValue(json({}));
    const controller = new AbortController();

    await authenticatedFetch("/a", { signal: controller.signal }, "override");
    expect(lastRequest().init.headers.Authorization).toBe("Bearer override");
    expect(lastRequest().init.signal).toBe(controller.signal);

    await authenticatedFetch("/b", { timeoutMs: null });
    expect(lastRequest().init.signal).toBeUndefined();

    await authenticatedFetch("/c", { signal: controller.signal, timeoutMs: 500 });
    const combined = lastRequest().init.signal!;
    expect(combined).not.toBe(controller.signal);
    controller.abort();
    expect(combined.aborted).toBe(true);
  });

  it("refuses to send a request without a token", async () => {
    await removeAuthToken();

    await expect(authenticatedFetch("/api/test")).rejects.toThrow("Not authenticated");
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});

describe("account requests", () => {
  it("returns the signed-in user", async () => {
    tauriFetch.mockResolvedValue(json({ user: { id: 1, email: "dev@athas.dev" } }));

    await expect(fetchCurrentUser()).resolves.toEqual({ id: 1, email: "dev@athas.dev" });
    expect(lastRequest().url).toMatch(/\/api\/auth\/me$/);
  });

  it("treats a token without a user as invalid", async () => {
    tauriFetch.mockResolvedValue(json({ user: null }));

    const error = await fetchCurrentUser().catch((failure) => failure);

    expect(error).toBeInstanceOf(AuthApiError);
    expect(isAuthInvalidError(error)).toBe(true);
  });

  it("reads the session error code from the response body", async () => {
    tauriFetch.mockResolvedValueOnce(json({ error: { code: "session_revoked" } }, 403));
    const revoked = await fetchCurrentUser().catch((failure) => failure);
    expect(revoked).toMatchObject({ status: 403, code: "session_revoked" });
    expect(isAuthInvalidError(revoked)).toBe(true);

    tauriFetch.mockResolvedValueOnce(json({ sessionInvalid: true }, 403));
    const flagged = await fetchCurrentUser().catch((failure) => failure);
    expect(flagged).toMatchObject({ code: "invalid_session" });

    tauriFetch.mockResolvedValueOnce(json({ code: "plan_required" }, 403));
    const forbidden = await fetchCurrentUser().catch((failure) => failure);
    expect(forbidden).toMatchObject({ code: "plan_required" });
    expect(isAuthInvalidError(forbidden)).toBe(false);

    tauriFetch.mockResolvedValueOnce(json(["unexpected"], 500));
    const serverError = await fetchCurrentUser().catch((failure) => failure);
    expect(serverError).toMatchObject({ status: 500, code: undefined });

    tauriFetch.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    const html = await fetchCurrentUser().catch((failure) => failure);
    expect(html).toMatchObject({ status: 502, code: undefined });
    expect(html.message).toBe("Failed to fetch user: 502");
  });

  it("parses the subscription and rejects malformed payloads", async () => {
    tauriFetch.mockResolvedValueOnce(
      json({
        status: "pro",
        subscription: { plan: "pro", renews_at: null, ends_at: null },
      }),
    );
    await expect(fetchSubscriptionStatus("token")).resolves.toMatchObject({ status: "pro" });

    tauriFetch.mockResolvedValueOnce(json({ nope: true }));
    await expect(fetchSubscriptionStatus()).rejects.toThrow("Subscription response was malformed.");

    tauriFetch.mockResolvedValueOnce(json({}, 401));
    const unauthorized = await fetchSubscriptionStatus().catch((failure) => failure);
    expect(isAuthInvalidError(unauthorized)).toBe(true);
  });

  it("updates the enterprise policy and surfaces server errors", async () => {
    tauriFetch.mockResolvedValueOnce(json({ policy: { allowHostedAi: false } }));
    await expect(updateEnterprisePolicy({ allowHostedAi: false } as never)).resolves.toEqual({
      allowHostedAi: false,
    });
    expect(lastRequest().init).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ allowHostedAi: false }),
    });

    tauriFetch.mockResolvedValueOnce(json({ error: "Only admins can change policy" }, 403));
    await expect(updateEnterprisePolicy({})).rejects.toThrow("Only admins can change policy");

    tauriFetch.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(updateEnterprisePolicy({})).rejects.toThrow(
      "Failed to update enterprise policy: 500",
    );
  });

  it("logs out on the server with the saved token and ignores failures", async () => {
    tauriFetch.mockRejectedValueOnce(new Error("offline"));
    await expect(logoutFromServer()).resolves.toBeUndefined();
    expect(lastRequest().url).toMatch(/\/api\/auth\/logout$/);
    expect(lastRequest().init).toMatchObject({
      method: "DELETE",
      headers: { Authorization: "Bearer saved-token" },
    });

    await removeAuthToken();
    tauriFetch.mockClear();
    await logoutFromServer();
    expect(tauriFetch).not.toHaveBeenCalled();
  });
});

describe("desktop sign-in", () => {
  it("starts a session on the requested server", async () => {
    tauriFetch.mockResolvedValue(
      json({ sessionId: "s1", pollSecret: "p1", loginUrl: "https://athas.dev/login" }),
    );

    await expect(beginDesktopAuthSession({ apiBase: "http://localhost:3000/" })).resolves.toEqual({
      sessionId: "s1",
      pollSecret: "p1",
      loginUrl: "https://athas.dev/login",
      apiBase: "http://localhost:3000",
    });
    expect(lastRequest().url).toBe("http://localhost:3000/api/auth/desktop/session/init");
  });

  it("explains why a session could not start", async () => {
    tauriFetch.mockRejectedValueOnce(new TypeError("connection refused"));
    await expect(beginDesktopAuthSession({ apiBase: "http://localhost:3000" })).rejects.toThrow(
      "Could not reach local auth server at http://localhost:3000.",
    );

    tauriFetch.mockRejectedValueOnce(new TypeError("connection refused"));
    await expect(beginDesktopAuthSession({ apiBase: "https://auth.example.com" })).rejects.toThrow(
      "Could not reach auth server at https://auth.example.com.",
    );

    tauriFetch.mockResolvedValueOnce(json({}, 404));
    await expect(beginDesktopAuthSession({ apiBase: "https://a.example" })).rejects.toMatchObject({
      code: "endpoint_unavailable",
    });

    tauriFetch.mockResolvedValueOnce(json({}, 500));
    await expect(beginDesktopAuthSession({ apiBase: "https://a.example" })).rejects.toThrow(
      "Desktop sign-in failed (500).",
    );

    tauriFetch.mockResolvedValueOnce(json({ sessionId: "s1" }));
    await expect(beginDesktopAuthSession({ apiBase: "https://a.example" })).rejects.toThrow(
      "Invalid desktop sign-in response.",
    );
  });

  it("rethrows the caller's abort instead of a connection error", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    tauriFetch.mockRejectedValueOnce(new Error("aborted"));

    await expect(
      beginDesktopAuthSession({ apiBase: "https://a.example", signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });

  it("polls until the token is ready, sending the poll secret", async () => {
    vi.useFakeTimers();
    tauriFetch
      .mockResolvedValueOnce(json({ status: "pending" }))
      .mockResolvedValueOnce(json({ status: "ready", token: "jwt" }));

    const token = waitForDesktopAuthToken("s 1", "secret", 60_000, {
      apiBase: "https://a.example",
    });
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(token).resolves.toBe("jwt");
    expect(tauriFetch).toHaveBeenCalledTimes(2);
    expect(lastRequest().url).toBe("https://a.example/api/auth/desktop/session?session=s%201");
    expect(lastRequest().init.headers).toEqual({ "X-Desktop-Session-Secret": "secret" });
  });

  it("reports expired, missing and invalid sessions", async () => {
    const poll = () =>
      waitForDesktopAuthToken("s1", "secret", 60_000, { apiBase: "https://a.example" });

    tauriFetch.mockResolvedValueOnce(json({}, 410));
    await expect(poll()).rejects.toMatchObject({ code: "expired" });

    tauriFetch.mockResolvedValueOnce(json({ status: "expired" }));
    await expect(poll()).rejects.toThrow("Desktop sign-in session is no longer valid.");

    tauriFetch.mockResolvedValueOnce(json({ status: "missing" }, 404));
    await expect(poll()).rejects.toThrow("credentials are invalid");

    tauriFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(poll()).rejects.toMatchObject({ code: "endpoint_unavailable" });

    tauriFetch.mockResolvedValueOnce(json({ status: "pending" }, 503));
    await expect(poll()).rejects.toThrow("Desktop sign-in failed (503).");

    tauriFetch.mockResolvedValueOnce(json({ status: "weird" }));
    await expect(poll()).rejects.toThrow("Invalid desktop sign-in response.");
  });

  it("explains connection failures while polling", async () => {
    tauriFetch.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(
      waitForDesktopAuthToken("s1", "secret", 60_000, { apiBase: "https://a.example" }),
    ).rejects.toThrow("Could not reach auth server at https://a.example. socket hang up");

    tauriFetch.mockRejectedValueOnce("offline");
    await expect(
      waitForDesktopAuthToken("s1", "secret", 60_000, { apiBase: "https://a.example" }),
    ).rejects.toThrow("Could not reach auth server at https://a.example.");
  });

  it("times out when the session never becomes ready", async () => {
    vi.useFakeTimers();
    tauriFetch.mockImplementation(async () => json({ status: "pending" }));

    const token = waitForDesktopAuthToken("s1", "secret", 3_000, { apiBase: "https://a.example" });
    const outcome = expect(token).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(5_000);

    await outcome;
  });

  it("stops polling when the caller aborts", async () => {
    vi.useFakeTimers();
    tauriFetch.mockImplementation(async () => json({ status: "pending" }));
    const controller = new AbortController();

    const token = waitForDesktopAuthToken("s1", "secret", 60_000, {
      apiBase: "https://a.example",
      signal: controller.signal,
    });
    const outcome = expect(token).rejects.toThrow("user closed");
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new Error("user closed"));

    await outcome;
    expect(tauriFetch).toHaveBeenCalledOnce();
  });
});
