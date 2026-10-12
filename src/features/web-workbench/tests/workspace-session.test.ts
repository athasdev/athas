import { describe, expect, it, vi } from "vite-plus/test";
import {
  createSessionBridge,
  parseParentOrigins,
} from "@/features/web-workbench/bootstrap/workspace-session";

const session = {
  workspaceId: "0b6f7c1e-2f43-4a8e-9a51-3c2d1e0f9a87",
  endpoint: "https://cloud.athas.dev",
  token: "token-1",
  expiresAt: "2026-10-12T12:10:00.000Z",
  repo: "athasdev/athas",
  branch: "main",
};
const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function setup() {
  const parent = { postMessage: vi.fn() };
  const listeners = new Set<(event: MessageEvent) => void>();
  const bridge = createSessionBridge({
    parentOrigins: ["https://athas.dev"],
    parent,
    messages: {
      addEventListener(type, listener) {
        if (type === "message") listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === "message") listeners.delete(listener);
      },
    },
    timeoutMs: 50,
    now: () => NOW,
  });
  const deliver = (data: unknown, origin = "https://athas.dev", source: unknown = parent) => {
    for (const listener of listeners) listener({ data, origin, source } as MessageEvent);
  };
  return { bridge, parent, deliver };
}

describe("workspace session bridge", () => {
  it("reads the parent origins from the frame-ancestors list", () => {
    expect(
      parseParentOrigins("https://athas.dev 'self' https://*.athas.dev http://localhost:3000"),
    ).toEqual(["https://athas.dev", "http://localhost:3000"]);
    expect(parseParentOrigins(undefined)).toEqual([]);
  });

  it("asks the dashboard for a session and accepts it only from the parent on an allowed origin", async () => {
    const { bridge, parent, deliver } = setup();
    const waiting = bridge.waitForSession();
    expect(parent.postMessage).toHaveBeenCalledWith(
      { type: "athas-web-editor:session-request" },
      "https://athas.dev",
    );
    const message = { type: "athas-web-editor:workspace-session", session };
    deliver(message, "https://evil.example");
    deliver(message, "https://athas.dev", {});
    deliver({ ...message, session: { ...session, endpoint: "http://cloud.athas.dev" } });
    deliver(message);
    expect(await waiting).toEqual(session);
    expect(await bridge.getToken(false)).toBe("token-1");
  });

  it("asks for a new token when the Worker refused the old one or it is about to expire", async () => {
    const { bridge, parent, deliver } = setup();
    deliver({ type: "athas-web-editor:workspace-session", session });
    const refreshed = bridge.getToken(true);
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    deliver({
      type: "athas-web-editor:workspace-session",
      session: { ...session, token: "token-2" },
    });
    expect(await refreshed).toBe("token-2");

    deliver({
      type: "athas-web-editor:workspace-session",
      session: { ...session, token: "token-3", expiresAt: "2026-10-12T12:00:10.000Z" },
    });
    await expect(bridge.getToken(false)).rejects.toThrow("did not renew");
  });

  it("ignores sessions for another workspace and reports the end to the session's origin", async () => {
    const { bridge, parent, deliver } = setup();
    const renewals = vi.fn();
    bridge.onSession(renewals);
    deliver({ type: "athas-web-editor:workspace-session", session });
    deliver({
      type: "athas-web-editor:workspace-session",
      session: { ...session, workspaceId: "1b6f7c1e-2f43-4a8e-9a51-3c2d1e0f9a87" },
    });
    expect(renewals).toHaveBeenCalledTimes(1);
    bridge.notifyEnded();
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: "athas-web-editor:workspace-ended" },
      "https://athas.dev",
    );
  });

  it("resolves to null when no session arrives", async () => {
    const { bridge } = setup();
    expect(await bridge.waitForSession()).toBeNull();
  });
});
