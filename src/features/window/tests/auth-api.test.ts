import { describe, expect, it } from "vite-plus/test";
import { __test__ as apiBaseTest } from "@/utils/api-base";
import { AuthApiError, isAuthInvalidError, __test__ } from "../services/auth-api";

describe("auth-api desktop auth parsers", () => {
  it("parses valid desktop auth init response", () => {
    const parsed = __test__.parseDesktopAuthInitResponse({
      sessionId: "desktop-123",
      pollSecret: "secret-456",
      loginUrl: "https://athas.dev/auth/desktop?desktop_session=desktop-123",
    });

    expect(parsed).toEqual({
      sessionId: "desktop-123",
      pollSecret: "secret-456",
      loginUrl: "https://athas.dev/auth/desktop?desktop_session=desktop-123",
    });
  });

  it("rejects malformed desktop auth init response", () => {
    expect(__test__.parseDesktopAuthInitResponse({})).toBeNull();
    expect(
      __test__.parseDesktopAuthInitResponse({
        sessionId: "desktop-123",
        pollSecret: "secret-456",
        loginUrl: "",
      }),
    ).toBeNull();
  });

  it("parses valid desktop auth poll response", () => {
    const ready = __test__.parseDesktopAuthPollResponse({
      status: "ready",
      token: "jwt-token",
    });
    expect(ready).toEqual({ status: "ready", token: "jwt-token" });

    const pending = __test__.parseDesktopAuthPollResponse({ status: "pending" });
    expect(pending).toEqual({ status: "pending" });
  });

  it("rejects invalid desktop auth poll response", () => {
    expect(__test__.parseDesktopAuthPollResponse({ status: "ready", token: "" })).toBeNull();
    expect(__test__.parseDesktopAuthPollResponse({ status: "unknown" })).toBeNull();
  });

  it("detects local api base URLs", () => {
    expect(apiBaseTest.isLocalApiBase("http://localhost:3000")).toBe(true);
    expect(apiBaseTest.isLocalApiBase("http://127.0.0.1:3000")).toBe(true);
    expect(apiBaseTest.isLocalApiBase("https://athas.dev")).toBe(false);
  });

  it("only treats authorization failures as invalid auth", () => {
    expect(isAuthInvalidError(new AuthApiError("Unauthorized", 401))).toBe(true);
    expect(isAuthInvalidError(new AuthApiError("Forbidden", 403))).toBe(true);
    expect(isAuthInvalidError(new AuthApiError("Server error", 500))).toBe(false);
    expect(isAuthInvalidError(new Error("Network error"))).toBe(false);
  });
});
