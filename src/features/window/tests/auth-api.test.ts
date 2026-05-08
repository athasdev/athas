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

  it("parses Teams collaboration from the subscription payload", () => {
    const parsed = __test__.parseSubscriptionInfoResponse({
      status: "pro",
      subscription: { plan: "teams", renews_at: null, ends_at: null },
      enterprise: { has_access: false, is_admin: false, policy: null },
      collaboration: {
        enabled: true,
        workspace: {
          id: 1,
          name: "Team workspace",
          slug: "team-workspace",
          role: "owner",
          visibility: "private",
          realtimeProtocolVersion: 1,
        },
        members: [{ id: 1, userId: 1, name: "Owner", email: "owner@example.com" }],
        channels: [{ id: 1, name: "General", slug: "general" }],
        capabilities: { canInvite: true, presence: true, realtimeDocuments: true },
      },
    });

    expect(parsed?.collaboration?.enabled).toBe(true);
    expect(parsed?.collaboration?.workspace?.name).toBe("Team workspace");
    expect(parsed?.collaboration?.members).toHaveLength(1);
    expect(parsed?.collaboration?.channels).toHaveLength(1);
    expect(parsed?.collaboration?.invitations).toEqual([]);
    expect(parsed?.collaboration?.capabilities.canInvite).toBe(true);
    expect(parsed?.collaboration?.capabilities.canManageMembers).toBe(false);
  });

  it("normalizes malformed subscription plan fields", () => {
    const parsed = __test__.parseSubscriptionInfoResponse({
      status: "pro",
      subscription: { plan: "teams", renews_at: 123, ends_at: null },
      enterprise: { has_access: false, is_admin: false, policy: null },
      collaboration: null,
    });

    expect(parsed?.subscription).toEqual({
      plan: "teams",
      renews_at: null,
      ends_at: null,
    });
  });

  it("rejects malformed subscription payloads before storing them", () => {
    expect(__test__.parseSubscriptionInfoResponse(null)).toBeNull();
    expect(__test__.parseSubscriptionInfoResponse({ status: "unknown" })).toBeNull();
    expect(
      __test__.parseSubscriptionInfoResponse({
        status: "pro",
        enterprise: { has_access: false, is_admin: false },
        collaboration: { workspace: null },
      })?.collaboration,
    ).toBeNull();
  });

  it("parses collaboration document stream events", () => {
    const document = { id: 7, path: "README.md", baseVersion: 1, stateVector: {}, updatedAt: null };
    const update = {
      id: 9,
      documentId: 7,
      actorUserId: 1,
      clientId: "client-1",
      clientSeq: 1,
      serverVersion: 2,
      updateType: "cursor",
      operation: { cursor: { line: 1, column: 2 } },
      createdAt: null,
    };

    expect(
      __test__.parseCollaborationSseBlock(
        `event: ready\ndata: ${JSON.stringify({ document, afterServerVersion: 1 })}\n\n`,
      ),
    ).toEqual({
      type: "ready",
      document,
      afterServerVersion: 1,
      pollIntervalMs: 2000,
    });
    expect(
      __test__.parseCollaborationSseBlock(
        `event: update\ndata: ${JSON.stringify({ document, update })}\n\n`,
      ),
    ).toEqual({ type: "update", document, update });
    expect(
      __test__.parseCollaborationSseBlock(
        `event: heartbeat\ndata: ${JSON.stringify({ document, afterServerVersion: 2 })}\n\n`,
      ),
    ).toEqual({ type: "heartbeat", document, afterServerVersion: 2 });
    expect(
      __test__.parseCollaborationSseBlock(
        `event: error\ndata: ${JSON.stringify({ error: "Stream failed", status: 409 })}\n\n`,
      ),
    ).toEqual({ type: "error", error: "Stream failed", status: 409 });
  });

  it("ignores malformed collaboration document stream events", () => {
    expect(__test__.parseCollaborationSseBlock("event: update\ndata: {}\n\n")).toBeNull();
    expect(__test__.parseCollaborationSseBlock("event: ready\n\n")).toBeNull();
  });
});
