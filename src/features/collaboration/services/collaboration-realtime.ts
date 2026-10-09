import { AuthApiError, authenticatedFetch } from "@/features/auth/services/auth-api";
import type { CollaborationDocumentUpdate } from "@/features/collaboration/services/collaboration-api";

export type CollaborationRoomTarget = { documentId: number } | { channelId: number };

export interface CollaborationRoomTicket {
  url: string;
  expiresAt: number;
}

export interface CollaborationRoomMember {
  connectionId: string;
  userId: number;
  name?: string;
  deviceId?: string;
}

export type CollaborationMediaSignalKind = "offer" | "answer" | "ice" | "leave";

export type CollaborationRoomClientMessage =
  | { type: "presence"; data: Record<string, unknown> }
  | {
      type: "signal";
      kind: CollaborationMediaSignalKind;
      to?: string;
      payload: Record<string, unknown>;
    };

export type CollaborationRoomServerMessage =
  | { type: "welcome"; self: CollaborationRoomMember; members: CollaborationRoomMember[] }
  | { type: "join"; member: CollaborationRoomMember }
  | { type: "leave"; member: CollaborationRoomMember }
  | { type: "presence"; from: CollaborationRoomMember; data: Record<string, unknown> }
  | {
      type: "signal";
      from: CollaborationRoomMember;
      kind: CollaborationMediaSignalKind;
      to?: string;
      payload: Record<string, unknown>;
    }
  | { type: "error"; error: string };

export type CollaborationRoomStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "unavailable"
  | "closed";

export interface CollaborationRoomSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface CollaborationRoomConnection {
  isOpen: () => boolean;
  /** Sends now when open; with `queue`, holds the message until the socket (re)opens. */
  send: (message: CollaborationRoomClientMessage, options?: { queue?: boolean }) => boolean;
  close: () => void;
}

const SOCKET_OPEN = 1;
/** The room closes a socket with this code when its token expired without being renewed. */
export const ROOM_TOKEN_EXPIRED_CLOSE_CODE = 4001;
/** The account service answers 404 while realtime rooms are off; ask again after this long. */
const REALTIME_DISABLED_RETRY_MS = 5 * 60_000;
const TICKET_REFRESH_MARGIN_MS = 60_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const KEEPALIVE_MS = 30_000;
/** Failed connection attempts before a room that never opened gives way to polling. */
const MAX_ATTEMPTS_BEFORE_FALLBACK = 3;
const MAX_QUEUED_MESSAGES = 100;

let realtimeDisabledUntil = 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export async function requestCollaborationRoomTicket(
  target: CollaborationRoomTarget,
  deviceId: string,
  now = Date.now(),
): Promise<CollaborationRoomTicket | null> {
  if (realtimeDisabledUntil > now) return null;

  const response = await authenticatedFetch("/api/collaboration/rooms/token", {
    method: "POST",
    body: JSON.stringify({ ...target, deviceId }),
    timeoutMs: 10_000,
  });
  const payload = (await response.json().catch(() => null)) as {
    url?: unknown;
    expiresAt?: unknown;
    error?: string;
  } | null;

  if (response.status === 404) {
    realtimeDisabledUntil = now + REALTIME_DISABLED_RETRY_MS;
    return null;
  }
  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to join collaboration room: ${response.status}`,
      response.status,
    );
  }

  const expiresAt = typeof payload?.expiresAt === "string" ? Date.parse(payload.expiresAt) : NaN;
  if (typeof payload?.url !== "string" || !/^wss?:\/\//.test(payload.url)) return null;
  return { url: payload.url, expiresAt: Number.isFinite(expiresAt) ? expiresAt : now };
}

export function resetCollaborationRealtimeAvailability() {
  realtimeDisabledUntil = 0;
}

export function parseCollaborationRoomMessage(raw: unknown): CollaborationRoomServerMessage | null {
  if (typeof raw !== "string" || raw === "pong") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  const isMember = (member: unknown): member is CollaborationRoomMember =>
    isRecord(member) &&
    typeof member.connectionId === "string" &&
    typeof member.userId === "number";

  switch (value.type) {
    case "welcome":
      return isMember(value.self) && Array.isArray(value.members)
        ? { type: "welcome", self: value.self, members: value.members.filter(isMember) }
        : null;
    case "join":
    case "leave":
      return isMember(value.member) ? { type: value.type, member: value.member } : null;
    case "presence":
      return isMember(value.from) && isRecord(value.data)
        ? { type: "presence", from: value.from, data: value.data }
        : null;
    case "signal":
      return isMember(value.from) &&
        (value.kind === "offer" ||
          value.kind === "answer" ||
          value.kind === "ice" ||
          value.kind === "leave") &&
        isRecord(value.payload)
        ? {
            type: "signal",
            from: value.from,
            kind: value.kind,
            ...(typeof value.to === "string" ? { to: value.to } : {}),
            payload: value.payload,
          }
        : null;
    case "error":
      return typeof value.error === "string" ? { type: "error", error: value.error } : null;
    default:
      return null;
  }
}

/** A relayed cursor or viewport update, shaped like a stored document update. */
export function toRemoteDocumentUpdate(
  documentId: number,
  message: Extract<CollaborationRoomServerMessage, { type: "presence" }>,
): CollaborationDocumentUpdate | null {
  const { updateType, operation } = message.data;
  if ((updateType !== "cursor" && updateType !== "metadata") || !isRecord(operation)) return null;
  if (!message.from.deviceId) return null;

  return {
    id: 0,
    documentId,
    actorUserId: message.from.userId,
    clientId: message.from.deviceId,
    clientSeq: 0,
    serverVersion: 0,
    updateType,
    operation,
    createdAt: new Date().toISOString(),
  };
}

function ticketToken(ticket: CollaborationRoomTicket) {
  try {
    return new URL(ticket.url).searchParams.get("token");
  } catch {
    return null;
  }
}

export function reconnectDelay(attempt: number, random = Math.random()) {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + random * 0.5));
}

/**
 * Keeps a WebSocket to a realtime collaboration room open: it reconnects with backoff, fetches a
 * fresh room token shortly before the current one expires and renews the open socket with it,
 * and reports "unavailable" when the account service has realtime rooms off or the room never
 * opens, so callers can keep polling. When the room closes the socket because its token expired
 * (4001), the next connection asks for a new token.
 */
export function connectCollaborationRoom(options: {
  target: CollaborationRoomTarget;
  deviceId: string;
  onMessage: (message: CollaborationRoomServerMessage) => void;
  onStatus?: (status: CollaborationRoomStatus) => void;
  requestTicket?: typeof requestCollaborationRoomTicket;
  createSocket?: (url: string) => CollaborationRoomSocket;
  now?: () => number;
}): CollaborationRoomConnection {
  const requestTicket = options.requestTicket ?? requestCollaborationRoomTicket;
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const now = options.now ?? Date.now;

  let socket: CollaborationRoomSocket | null = null;
  let ticket: CollaborationRoomTicket | null = null;
  let status: CollaborationRoomStatus = "connecting";
  let closed = false;
  let everOpened = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  const queue: string[] = [];

  const setStatus = (next: CollaborationRoomStatus) => {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  };

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (refreshTimer) clearTimeout(refreshTimer);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    reconnectTimer = refreshTimer = keepaliveTimer = null;
  };

  const giveUp = () => {
    clearTimers();
    queue.length = 0;
    setStatus("unavailable");
  };

  const scheduleRefresh = (current: CollaborationRoomTicket) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const delay = Math.max(0, current.expiresAt - TICKET_REFRESH_MARGIN_MS - now());
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void requestTicket(options.target, options.deviceId)
        .then((next) => {
          if (closed || !next) return;
          ticket = next;
          scheduleRefresh(next);
          const token = ticketToken(next);
          if (token && socket?.readyState === SOCKET_OPEN) {
            socket.send(JSON.stringify({ type: "renew", token }));
          }
        })
        .catch(() => {
          if (!closed) refreshTimer = setTimeout(() => scheduleRefresh(current), RECONNECT_MAX_MS);
        });
    }, delay);
  };

  const scheduleReconnect = () => {
    attempts += 1;
    if (!everOpened && attempts >= MAX_ATTEMPTS_BEFORE_FALLBACK) {
      giveUp();
      return;
    }
    setStatus("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void open();
    }, reconnectDelay(attempts));
  };

  const open = async () => {
    if (closed) return;
    let current = ticket && ticket.expiresAt - TICKET_REFRESH_MARGIN_MS / 2 > now() ? ticket : null;
    if (!current) {
      try {
        current = await requestTicket(options.target, options.deviceId);
      } catch {
        if (!closed) scheduleReconnect();
        return;
      }
      if (closed) return;
      if (!current) {
        giveUp();
        return;
      }
      ticket = current;
    }

    let next: CollaborationRoomSocket;
    try {
      next = createSocket(current.url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;

    const handleClose = (code?: number) => {
      if (socket !== next) return;
      socket = null;
      if (code === ROOM_TOKEN_EXPIRED_CLOSE_CODE) ticket = null;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = null;
      if (!closed) scheduleReconnect();
    };

    next.onopen = () => {
      if (closed || socket !== next) return;
      attempts = 0;
      everOpened = true;
      setStatus("open");
      for (const message of queue.splice(0)) next.send(message);
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = setInterval(() => {
        if (next.readyState === SOCKET_OPEN) next.send("ping");
        // A closing handshake the server never finishes leaves no close event behind.
        else handleClose();
      }, KEEPALIVE_MS);
      scheduleRefresh(current);
    };
    next.onmessage = (event) => {
      if (socket !== next) return;
      const message = parseCollaborationRoomMessage(event.data);
      if (message) options.onMessage(message);
    };
    next.onclose = (event) => handleClose(event.code);
  };

  options.onStatus?.(status);
  void open();

  return {
    isOpen: () => !closed && socket?.readyState === SOCKET_OPEN,
    send: (message, sendOptions) => {
      if (closed || status === "unavailable") return false;
      const data = JSON.stringify(message);
      if (socket?.readyState === SOCKET_OPEN) {
        socket.send(data);
        return true;
      }
      if (!sendOptions?.queue || queue.length >= MAX_QUEUED_MESSAGES) return false;
      queue.push(data);
      return true;
    },
    close: () => {
      if (closed) return;
      closed = true;
      clearTimers();
      queue.length = 0;
      const current = socket;
      socket = null;
      current?.close(1000, "Closed");
      setStatus("closed");
    },
  };
}

/**
 * Sends a cursor or viewport update through the document's room when it is open, and through
 * the account service's document updates otherwise.
 */
export function publishDocumentPresence(input: {
  room: CollaborationRoomConnection | null;
  updateType: "cursor" | "metadata";
  operation: Record<string, unknown>;
  sendOverRest: () => void;
}): "realtime" | "rest" {
  if (
    input.room?.isOpen() &&
    input.room.send({
      type: "presence",
      data: { updateType: input.updateType, operation: input.operation },
    })
  ) {
    return "realtime";
  }
  input.sendOverRest();
  return "rest";
}
