import {
  decodeTerminalFrame,
  SOCKET_NOT_READY,
  SOCKET_STOPPED,
  SOCKET_UNAUTHORIZED,
  type WorkspaceEvent,
  type WorkspaceInfo,
  type WorkspaceSession,
  workspaceSocketUrl,
} from "@/features/web-workbench/services/workspace-protocol";

/** What the remote backend needs from a connection to a cloud workspace. */
export interface WorkspaceTransport {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(listener: (event: WorkspaceEvent) => void): () => void;
  onTerminalOutput(listener: (id: string, data: Uint8Array) => void): () => void;
}

export interface WorkspaceConnection extends WorkspaceTransport {
  /** Resolves with the workspace once the socket has authenticated. */
  ready: Promise<WorkspaceInfo>;
  /** Hands the socket a fresh token; the app fetches one every few minutes. */
  renew(token: string): void;
  close(): void;
}

export class WorkspaceCallError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "WorkspaceCallError";
  }
}

export interface WorkspaceConnectionOptions {
  session: WorkspaceSession;
  /**
   * A token that is still valid, asking the website for a new one when needed or when
   * `refresh` says the Worker refused the last one.
   */
  getToken: (refresh: boolean) => Promise<string>;
  createSocket?: (url: string) => WebSocket;
  /** Delays between reconnect attempts; the last one repeats. */
  retryDelaysMs?: number[];
  pingIntervalMs?: number;
}

const OPEN = 1;

/**
 * The web app's connection to a cloud workspace: one WebSocket that authenticates with its first
 * message (tokens never go into the URL), carries calls and their results, and pushes file
 * changes and terminal output. It reconnects after drops, fetching a new token when the old one
 * was refused, and reports `stopped` when the workspace ends.
 */
export function connectWorkspace(options: WorkspaceConnectionOptions): WorkspaceConnection {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const retryDelays = options.retryDelaysMs ?? [500, 1000, 2000, 5000, 10_000];
  const eventListeners = new Set<(event: WorkspaceEvent) => void>();
  const outputListeners = new Set<(id: string, data: Uint8Array) => void>();
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const queued: string[] = [];
  let socket: WebSocket | null = null;
  let authenticated = false;
  let everReady = false;
  let closed = false;
  let attempt = 0;
  let nextId = 1;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let resolveReady!: (workspace: WorkspaceInfo) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<WorkspaceInfo>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A connection that never becomes ready is reported by the caller; avoid an unhandled rejection.
  ready.catch(() => {});

  const emit = (event: WorkspaceEvent) => {
    for (const listener of eventListeners) listener(event);
  };

  function failPending(message: string, code: string) {
    for (const { reject } of pending.values()) reject(new WorkspaceCallError(message, code));
    pending.clear();
  }

  function finish(reason: string, error?: string) {
    if (closed) return;
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    failPending("The cloud workspace stopped.", "stopped");
    rejectReady(new WorkspaceCallError(error ?? "The cloud workspace stopped.", "stopped"));
    emit({ type: "stopped", reason, ...(error ? { error } : {}) });
  }

  function send(data: string) {
    if (socket && authenticated && socket.readyState === OPEN) socket.send(data);
    else queued.push(data);
  }

  function handleMessage(data: unknown) {
    if (data instanceof ArrayBuffer) {
      const frame = decodeTerminalFrame(new Uint8Array(data));
      if (frame) for (const listener of outputListeners) listener(frame.id, frame.data);
      return;
    }
    if (typeof data !== "string") return;
    let message: Record<string, any>;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    switch (message.type) {
      case "ready": {
        authenticated = true;
        attempt = 0;
        const workspace = message.workspace as WorkspaceInfo;
        if (everReady) emit({ type: "reconnected", workspace });
        everReady = true;
        resolveReady(workspace);
        for (const item of queued.splice(0)) socket?.send(item);
        break;
      }
      case "result": {
        const call = pending.get(message.id);
        if (!call) break;
        pending.delete(message.id);
        if (message.ok) call.resolve(message.value);
        else
          call.reject(
            new WorkspaceCallError(
              message.error?.message ?? "The workspace call failed.",
              message.error?.code ?? "error",
            ),
          );
        break;
      }
      case "fs.changes":
      case "terminal.exit":
        emit(message as WorkspaceEvent);
        break;
      case "stopped":
        finish(String(message.reason ?? "stopped"), message.error);
        break;
    }
  }

  function scheduleReconnect(refreshToken: boolean) {
    if (closed) return;
    const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
    attempt++;
    setTimeout(() => void open(refreshToken), delay);
  }

  async function open(refreshToken = false) {
    if (closed) return;
    let token: string;
    try {
      token = await options.getToken(refreshToken);
    } catch {
      finish("unauthorized", "Athas could not get access to the cloud workspace.");
      return;
    }
    if (closed) return;
    const current = createSocket(workspaceSocketUrl(options.session));
    socket = current;
    authenticated = false;
    current.binaryType = "arraybuffer";
    current.onopen = () => current.send(JSON.stringify({ type: "auth", token }));
    current.onmessage = (event) => {
      if (socket === current) handleMessage(event.data);
    };
    current.onerror = () => {};
    current.onclose = (event) => {
      if (socket !== current) return;
      socket = null;
      authenticated = false;
      // Calls in flight may or may not have run; the caller decides whether to retry them.
      failPending("The connection to the cloud workspace was lost.", "disconnected");
      if (event.code === SOCKET_STOPPED) {
        finish("stopped");
        return;
      }
      if (attempt >= 8 && !everReady) {
        finish("unreachable", "The cloud workspace could not be reached.");
        return;
      }
      scheduleReconnect(event.code === SOCKET_UNAUTHORIZED || event.code === SOCKET_NOT_READY);
    };
  }

  void open();
  pingTimer = setInterval(() => {
    if (socket && authenticated && socket.readyState === OPEN)
      socket.send(JSON.stringify({ type: "ping" }));
  }, options.pingIntervalMs ?? 25_000);

  return {
    ready,
    call<T>(method: string, params: Record<string, unknown> = {}) {
      if (closed)
        return Promise.reject(new WorkspaceCallError("The cloud workspace stopped.", "stopped"));
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        send(JSON.stringify({ type: "call", id, method, params }));
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onTerminalOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
    renew(token) {
      if (socket && authenticated && socket.readyState === OPEN)
        socket.send(JSON.stringify({ type: "renew", token }));
    },
    close() {
      const current = socket;
      finish("closed");
      socket = null;
      current?.close(1000, "Closed");
    },
  };
}
