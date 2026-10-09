import { authenticatedFetch } from "@/features/auth/services/auth-api";

export const PUBLIC_STUN_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

/** Credentials are refreshed this long before the server says they expire. */
const ICE_SERVERS_REFRESH_MARGIN_MS = 5 * 60_000;

let cached: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;
let pending: Promise<RTCIceServer[]> | null = null;

function parseIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RTCIceServer[] => {
    if (!entry || typeof entry !== "object") return [];
    const server = entry as Record<string, unknown>;
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
      (url): url is string => typeof url === "string" && url.length > 0,
    );
    if (!urls.length) return [];
    return [
      {
        urls,
        ...(typeof server.username === "string" ? { username: server.username } : {}),
        ...(typeof server.credential === "string" ? { credential: server.credential } : {}),
      },
    ];
  });
}

async function requestIceServers(now: number): Promise<RTCIceServer[]> {
  try {
    const response = await authenticatedFetch("/api/collaboration/ice-servers", {
      timeoutMs: 10_000,
    });
    if (!response.ok) return PUBLIC_STUN_ICE_SERVERS;

    const payload = (await response.json().catch(() => null)) as {
      iceServers?: unknown;
      expiresAt?: unknown;
    } | null;
    const iceServers = parseIceServers(payload?.iceServers);
    const expiresAt = typeof payload?.expiresAt === "string" ? Date.parse(payload.expiresAt) : NaN;
    if (!iceServers.length) return PUBLIC_STUN_ICE_SERVERS;

    if (Number.isFinite(expiresAt) && expiresAt - ICE_SERVERS_REFRESH_MARGIN_MS > now) {
      cached = { iceServers, expiresAt: expiresAt - ICE_SERVERS_REFRESH_MARGIN_MS };
    }
    return iceServers;
  } catch {
    return PUBLIC_STUN_ICE_SERVERS;
  }
}

/**
 * ICE servers for collaboration peer connections. TURN credentials from the account service are
 * kept in memory only until shortly before they expire; any failure falls back to public STUN.
 */
export function getCollaborationIceServers(now = Date.now()): Promise<RTCIceServer[]> {
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.iceServers);
  cached = null;
  pending ??= requestIceServers(now).finally(() => {
    pending = null;
  });
  return pending;
}

export function resetCollaborationIceServersCache() {
  cached = null;
  pending = null;
}
