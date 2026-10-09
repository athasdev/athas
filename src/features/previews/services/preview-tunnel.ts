import type { PreviewConnectTicket, PreviewTunnelStatus } from "../types/previews.types";
import {
  type DesktopFrame,
  encodeFrame,
  PREVIEW_ENDED_CLOSE_CODE,
  parseServerFrame,
  TUNNEL_REPLACED_CLOSE_CODE,
  TUNNEL_TOKEN_EXPIRED_CLOSE_CODE,
} from "./preview-protocol";
import { type ProxyFetch, proxyLocalRequest } from "./preview-proxy";

export interface PreviewTunnelSocket {
  readonly readyState: number;
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface PreviewTunnelConnection {
  status: () => PreviewTunnelStatus;
  close: () => void;
}

/** Thrown by `requestTicket` when the account service says the preview is over. */
export class PreviewEndedError extends Error {
  name = "PreviewEndedError";
}

const SOCKET_OPEN = 1;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const KEEPALIVE_MS = 25_000;
const TICKET_REFRESH_MARGIN_MS = 60_000;
/** Requests answered at once; the Worker queues at most 64 per preview. */
const MAX_CONCURRENT_REQUESTS = 32;

export function reconnectDelay(attempt: number, random = Math.random()) {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + random * 0.5));
}

function ticketToken(ticket: PreviewConnectTicket) {
  try {
    return new URL(ticket.url).searchParams.get("token");
  } catch {
    return null;
  }
}

/**
 * Keeps a local preview's tunnel to the athas-cloud Worker open and answers the visitor
 * requests that arrive on it from `http://localhost:<port>`. It renews its token over the socket
 * before it expires, reconnects with backoff after network trouble or an expired token, and
 * stops for good once the preview ends (stopped, expired, or taken over by another connection).
 */
export function connectPreviewTunnel(options: {
  port: number;
  ticket: PreviewConnectTicket;
  requestTicket: () => Promise<PreviewConnectTicket>;
  fetch: ProxyFetch;
  onStatus?: (status: PreviewTunnelStatus) => void;
  onRequest?: (result: { method: string; path: string; status: number | null }) => void;
  createSocket?: (url: string) => PreviewTunnelSocket;
  now?: () => number;
}): PreviewTunnelConnection {
  const createSocket =
    options.createSocket ?? ((url: string) => new WebSocket(url) as PreviewTunnelSocket);
  const now = options.now ?? Date.now;

  let ticket: PreviewConnectTicket | null = options.ticket;
  let socket: PreviewTunnelSocket | null = null;
  let status: PreviewTunnelStatus = "connecting";
  let closed = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  const inFlight = new Map<string, AbortController>();

  const setStatus = (next: PreviewTunnelStatus) => {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  };

  const abortAll = () => {
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
  };

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (refreshTimer) clearTimeout(refreshTimer);
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    reconnectTimer = refreshTimer = keepaliveTimer = null;
  };

  const end = () => {
    closed = true;
    clearTimers();
    abortAll();
    const current = socket;
    socket = null;
    try {
      current?.close(1000, "Closed");
    } catch {
      // Already closed.
    }
    setStatus("ended");
  };

  const send = (target: PreviewTunnelSocket, frame: DesktopFrame, payload?: Uint8Array) => {
    if (target.readyState !== SOCKET_OPEN) return;
    target.send(encodeFrame(frame, payload));
  };

  const fetchTicket = async () => {
    try {
      return await options.requestTicket();
    } catch (error) {
      if (error instanceof PreviewEndedError) end();
      throw error;
    }
  };

  const scheduleRefresh = (current: PreviewConnectTicket) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const delay = Math.max(0, Date.parse(current.expiresAt) - TICKET_REFRESH_MARGIN_MS - now());
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void fetchTicket()
        .then((next) => {
          if (closed) return;
          ticket = next;
          scheduleRefresh(next);
          const token = ticketToken(next);
          if (token && socket) send(socket, { type: "renew", token });
        })
        .catch(() => {
          if (!closed) refreshTimer = setTimeout(() => scheduleRefresh(current), RECONNECT_MAX_MS);
        });
    }, delay);
  };

  const scheduleReconnect = () => {
    attempts += 1;
    setStatus("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void open();
    }, reconnectDelay(attempts));
  };

  const handleRequest = (
    target: PreviewTunnelSocket,
    frame: Extract<ReturnType<typeof parseServerFrame>, object>,
  ) => {
    const request = frame.frame;
    if (request.type !== "request") return;
    if (inFlight.size >= MAX_CONCURRENT_REQUESTS) {
      send(target, { type: "error", id: request.id, message: "Too many requests at once." });
      return;
    }
    const controller = new AbortController();
    inFlight.set(request.id, controller);
    void proxyLocalRequest({
      request,
      body: frame.payload.slice(),
      port: options.port,
      fetch: options.fetch,
      send: (outgoing, payload) => send(target, outgoing, payload),
      signal: controller.signal,
    }).then((result) => {
      inFlight.delete(request.id);
      if (controller.signal.aborted) return;
      options.onRequest?.({
        method: request.method,
        path: request.path,
        status: "status" in result ? result.status : null,
      });
    });
  };

  const open = async () => {
    if (closed) return;
    let current =
      ticket && Date.parse(ticket.expiresAt) - TICKET_REFRESH_MARGIN_MS / 2 > now() ? ticket : null;
    if (!current) {
      try {
        current = await fetchTicket();
      } catch {
        if (!closed) scheduleReconnect();
        return;
      }
      if (closed) return;
      ticket = current;
    }

    let next: PreviewTunnelSocket;
    try {
      next = createSocket(current.url);
      next.binaryType = "arraybuffer";
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;
    let welcomed = false;

    const handleClose = (code?: number) => {
      if (socket !== next) return;
      socket = null;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = null;
      abortAll();
      if (closed) return;
      if (code === PREVIEW_ENDED_CLOSE_CODE || code === TUNNEL_REPLACED_CLOSE_CODE) {
        end();
        return;
      }
      // A refused connection may mean the preview ended; a fresh ticket from the account
      // service tells, and it ends the tunnel when it has.
      if (code === TUNNEL_TOKEN_EXPIRED_CLOSE_CODE || !welcomed) ticket = null;
      scheduleReconnect();
    };

    next.onopen = () => {
      if (closed || socket !== next) return;
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      keepaliveTimer = setInterval(() => {
        if (next.readyState === SOCKET_OPEN) next.send("ping");
        // A closing handshake the server never finishes leaves no close event behind.
        else handleClose();
      }, KEEPALIVE_MS);
      scheduleRefresh(current);
    };
    next.onmessage = (event) => {
      if (socket !== next || typeof event.data === "string") return;
      const parsed = parseServerFrame(event.data as ArrayBuffer);
      if (!parsed) return;
      const { frame } = parsed;
      if (frame.type === "welcome") {
        welcomed = true;
        attempts = 0;
        setStatus("open");
      } else if (frame.type === "request") {
        handleRequest(next, parsed);
      } else if (frame.type === "cancel") {
        inFlight.get(frame.id)?.abort();
        inFlight.delete(frame.id);
      } else if (frame.type === "notice") {
        console.warn("[previews]", frame.message);
      }
    };
    next.onclose = (event) => handleClose(event.code);
  };

  options.onStatus?.(status);
  void open();

  return {
    status: () => status,
    close: () => {
      if (!closed) end();
    },
  };
}
