import { describe, expect, it } from "bun:test";
import { __test__ } from "./auth-api";

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
});
