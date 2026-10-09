import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const authenticatedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/services/auth-api", () => ({ authenticatedFetch }));

import {
  getCollaborationIceServers,
  PUBLIC_STUN_ICE_SERVERS,
  resetCollaborationIceServersCache,
} from "../services/collaboration-ice-servers";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const turnServers = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
    username: "user",
    credential: "secret",
  },
];

function respond(body: unknown, status = 200) {
  authenticatedFetch.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("collaboration ICE servers", () => {
  beforeEach(() => {
    resetCollaborationIceServersCache();
    authenticatedFetch.mockReset();
  });

  it("uses the servers from the account service and caches them until near expiry", async () => {
    respond({ iceServers: turnServers, expiresAt: "2026-10-10T12:00:00.000Z" });

    await expect(getCollaborationIceServers(NOW)).resolves.toEqual(turnServers);
    await expect(getCollaborationIceServers(NOW + 60_000)).resolves.toEqual(turnServers);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(authenticatedFetch).toHaveBeenCalledWith("/api/collaboration/ice-servers", {
      timeoutMs: 10_000,
    });

    await getCollaborationIceServers(Date.parse("2026-10-10T11:56:00.000Z"));
    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    respond({ iceServers: turnServers, expiresAt: "2026-10-10T12:00:00.000Z" });

    await Promise.all([getCollaborationIceServers(NOW), getCollaborationIceServers(NOW)]);
    expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to public STUN without caching the fallback", async () => {
    respond({ error: "Collaboration requires a Teams workspace." }, 403);
    await expect(getCollaborationIceServers(NOW)).resolves.toEqual(PUBLIC_STUN_ICE_SERVERS);

    authenticatedFetch.mockRejectedValue(new Error("offline"));
    await expect(getCollaborationIceServers(NOW)).resolves.toEqual(PUBLIC_STUN_ICE_SERVERS);

    respond({ iceServers: [{ urls: [] }], expiresAt: "2026-10-10T12:00:00.000Z" });
    await expect(getCollaborationIceServers(NOW)).resolves.toEqual(PUBLIC_STUN_ICE_SERVERS);
    expect(authenticatedFetch).toHaveBeenCalledTimes(3);
  });
});
