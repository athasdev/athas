import type {
  AcpInitializeExchange,
  AcpInitializeSummary,
  AcpTrafficEntry,
  AcpTrafficFilter,
  AcpTrafficMessage,
  AcpTrafficMessageKind,
} from "../types/acp-traffic.types";

/** How many entries the inspector keeps per process, matching the Rust ring buffer. */
export const ACP_TRAFFIC_MAX_ENTRIES = 2000;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idText(id: unknown): string | null {
  if (id === undefined) return null;
  return JSON.stringify(id);
}

function sessionIdOf(message: JsonObject): string | null {
  for (const field of ["params", "result"]) {
    const value = message[field];
    if (isObject(value) && typeof value.sessionId === "string") return value.sessionId;
  }
  return null;
}

function kindOf(hasMethod: boolean, hasId: boolean): AcpTrafficMessageKind {
  if (hasMethod) return hasId ? "request" : "notification";
  return hasId ? "response" : "unknown";
}

function baseMessage(entry: AcpTrafficEntry, key: string) {
  return {
    key,
    seq: entry.seq,
    timestampMs: entry.timestampMs,
    direction: entry.direction,
    raw: entry.line,
    truncated: entry.truncated,
    partnerKey: null,
    latencyMs: null,
  };
}

/** Splits a recorded line into the messages it carries; a batch line carries several. */
export function parseTrafficEntry(entry: AcpTrafficEntry): AcpTrafficMessage[] {
  const key = String(entry.seq);
  if (entry.direction === "stderr") {
    return [
      {
        ...baseMessage(entry, key),
        kind: "stderr",
        method: null,
        id: null,
        sessionId: null,
        payload: null,
        isError: false,
      },
    ];
  }

  if (entry.truncated) {
    const hasMethod = typeof entry.method === "string";
    const hasId = entry.id !== undefined;
    return [
      {
        ...baseMessage(entry, key),
        kind: kindOf(hasMethod, hasId),
        method: entry.method ?? null,
        id: hasId ? idText(entry.id) : null,
        sessionId: null,
        payload: null,
        isError: false,
      },
    ];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.line);
  } catch {
    parsed = undefined;
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item, index) => {
    const itemKey = items.length > 1 ? `${key}.${index}` : key;
    if (!isObject(item)) {
      return {
        ...baseMessage(entry, itemKey),
        kind: "unknown",
        method: null,
        id: null,
        sessionId: null,
        payload: item ?? null,
        isError: false,
      };
    }
    const method = typeof item.method === "string" ? item.method : null;
    const hasId = "id" in item;
    return {
      ...baseMessage(entry, itemKey),
      raw: items.length > 1 ? JSON.stringify(item) : entry.line,
      kind: kindOf(method !== null, hasId),
      method,
      id: hasId ? idText(item.id) : null,
      sessionId: sessionIdOf(item),
      payload: item,
      isError: "error" in item,
    };
  });
}

/**
 * Pairs each response with the request it answers: a response travels the other way from its
 * request and carries the same id. The response takes the request's method and session, and
 * both learn the latency. Requests without a response keep `partnerKey` null.
 */
export function pairTrafficMessages(messages: AcpTrafficMessage[]): AcpTrafficMessage[] {
  const pending = new Map<string, number>();
  const paired = messages.map((message) => ({ ...message }));
  paired.forEach((message, index) => {
    if (message.id === null) return;
    if (message.kind === "request") {
      pending.set(`${message.direction}:${message.id}`, index);
      return;
    }
    if (message.kind !== "response") return;
    const requestDirection = message.direction === "in" ? "out" : "in";
    const requestKey = `${requestDirection}:${message.id}`;
    const requestIndex = pending.get(requestKey);
    if (requestIndex === undefined) return;
    pending.delete(requestKey);
    const request = paired[requestIndex];
    const latencyMs = Math.max(0, message.timestampMs - request.timestampMs);
    request.partnerKey = message.key;
    request.latencyMs = latencyMs;
    message.partnerKey = request.key;
    message.latencyMs = latencyMs;
    message.method = message.method ?? request.method;
    message.sessionId = message.sessionId ?? request.sessionId;
  });
  return paired;
}

/** Parses and pairs recorded entries in order. */
export function buildTrafficMessages(entries: AcpTrafficEntry[]): AcpTrafficMessage[] {
  return pairTrafficMessages(entries.flatMap(parseTrafficEntry));
}

/** Adds live entries to a backlog, dropping repeats and keeping the newest entries. */
export function appendTrafficEntries(
  current: AcpTrafficEntry[],
  incoming: AcpTrafficEntry[],
  limit = ACP_TRAFFIC_MAX_ENTRIES,
): AcpTrafficEntry[] {
  const lastSeq = current.length > 0 ? current[current.length - 1].seq : -1;
  const fresh = incoming.filter((entry) => entry.seq > lastSeq);
  if (fresh.length === 0) return current;
  const next = [...current, ...fresh];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function filterTrafficMessages(
  messages: AcpTrafficMessage[],
  filter: AcpTrafficFilter,
): AcpTrafficMessage[] {
  const query = filter.query.trim().toLowerCase();
  return messages.filter((message) => {
    if (filter.direction !== "all" && message.direction !== filter.direction) return false;
    if (filter.sessionId !== null && message.sessionId !== filter.sessionId) return false;
    if (!query) return true;
    if (message.method?.toLowerCase().includes(query)) return true;
    if (message.id?.toLowerCase() === query) return true;
    return message.kind === "stderr" && message.raw.toLowerCase().includes(query);
  });
}

/** Session ids seen in the traffic, in first-seen order. */
export function trafficSessionIds(messages: AcpTrafficMessage[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.sessionId) ids.add(message.sessionId);
  }
  return [...ids];
}

/** The message as copied: pretty JSON when it parsed, the raw line otherwise. */
export function formatTrafficMessage(message: AcpTrafficMessage): string {
  if (message.payload !== null && message.payload !== undefined) {
    return JSON.stringify(message.payload, null, 2);
  }
  return message.raw;
}

const DIRECTION_LABEL = { in: "agent -> client", out: "client -> agent", stderr: "stderr" };

/** Every message as copied by "Copy all": a header line per message, then its body. */
export function formatTrafficMessages(messages: AcpTrafficMessage[]): string {
  return messages
    .map((message) => {
      const time = new Date(message.timestampMs).toISOString();
      const label = [DIRECTION_LABEL[message.direction], message.kind, message.method]
        .filter(Boolean)
        .join(" ");
      return `[${time}] ${label}${message.id ? ` #${message.id}` : ""}\n${formatTrafficMessage(message)}`;
    })
    .join("\n\n");
}

/** What the Capabilities tab shows from the `initialize` exchange. */
export function summarizeInitialize(exchange: AcpInitializeExchange): AcpInitializeSummary {
  const request = isObject(exchange.request) ? exchange.request : {};
  const params = isObject(request.params) ? request.params : {};
  const response = isObject(exchange.response) ? exchange.response : {};
  const result = isObject(response.result) ? response.result : {};
  return {
    protocolVersion: result.protocolVersion ?? params.protocolVersion ?? null,
    clientInfo: params.clientInfo ?? null,
    clientCapabilities: params.clientCapabilities ?? null,
    agentInfo: result.agentInfo ?? null,
    agentCapabilities: result.agentCapabilities ?? null,
    authMethods: result.authMethods ?? null,
    error: response.error ?? null,
  };
}
