import {
  isWorkspaceSession,
  SESSION_MESSAGE,
  SESSION_REQUEST_MESSAGE,
  WORKSPACE_ENDED_MESSAGE,
  type WorkspaceSession,
} from "@/features/web-workbench/services/workspace-protocol";

/** A token this close to expiring is replaced before it is used to connect. */
const TOKEN_MARGIN_MS = 30_000;

interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

interface MessageSource {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export interface SessionBridgeOptions {
  /** Origins allowed to embed the editor (its frame-ancestors); only they may hand it sessions. */
  parentOrigins: string[];
  parent: MessageTarget;
  messages: MessageSource;
  timeoutMs?: number;
  now?: () => number;
}

/** The origins from a frame-ancestors list, leaving out keywords and wildcards. */
export function parseParentOrigins(value: string | undefined) {
  return (value ?? "").split(/\s+/).filter((origin) => /^https?:\/\/[^*\s/]+$/.test(origin));
}

/**
 * Receives workspace sessions from the athas.dev dashboard that embeds the editor. Sessions are
 * accepted only from the parent window on an allowed origin, and requests and notices go only to
 * the origin the session came from; the token is never read from or written to a URL.
 */
export function createSessionBridge(options: SessionBridgeOptions) {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const listeners = new Set<(session: WorkspaceSession) => void>();
  let latest: WorkspaceSession | null = null;
  let sessionOrigin: string | null = null;

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== (options.parent as unknown)) return;
    if (!options.parentOrigins.includes(event.origin)) return;
    const data = event.data as { type?: unknown; session?: unknown } | null;
    if (data?.type !== SESSION_MESSAGE || !isWorkspaceSession(data.session)) return;
    // Once connected the editor stays with its workspace.
    if (latest && data.session.workspaceId !== latest.workspaceId) return;
    latest = data.session;
    sessionOrigin = event.origin;
    for (const listener of listeners) listener(data.session);
  };
  options.messages.addEventListener("message", handleMessage);

  function request() {
    // The request carries nothing, so it may go to whichever allowed origin embeds the editor.
    for (const origin of sessionOrigin ? [sessionOrigin] : options.parentOrigins)
      options.parent.postMessage({ type: SESSION_REQUEST_MESSAGE }, origin);
  }

  function nextSession(previousToken: string | null) {
    return new Promise<WorkspaceSession | null>((resolve) => {
      const timer = setTimeout(() => {
        listeners.delete(listener);
        resolve(null);
      }, timeoutMs);
      const listener = (session: WorkspaceSession) => {
        if (session.token === previousToken) return;
        clearTimeout(timer);
        listeners.delete(listener);
        resolve(session);
      };
      listeners.add(listener);
      request();
    });
  }

  return {
    /** The first session, or null when the dashboard sends none in time. */
    waitForSession() {
      return latest ? Promise.resolve(latest) : nextSession(null);
    },
    async getToken(refresh: boolean) {
      if (latest && !refresh && Date.parse(latest.expiresAt) - now() > TOKEN_MARGIN_MS)
        return latest.token;
      const session = await nextSession(latest?.token ?? null);
      if (!session) throw new Error("The dashboard did not renew access to the workspace.");
      return session.token;
    },
    onSession(listener: (session: WorkspaceSession) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notifyEnded() {
      if (sessionOrigin)
        options.parent.postMessage({ type: WORKSPACE_ENDED_MESSAGE }, sessionOrigin);
    },
    dispose() {
      options.messages.removeEventListener("message", handleMessage);
      listeners.clear();
    },
  };
}
