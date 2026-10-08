import {
  AuthApiError,
  authenticatedFetch,
  type SubscriptionInfo,
} from "@/features/auth/services/auth-api";

let collaborationDeviceIdCache: string | null = null;
const COLLABORATION_DEVICE_ID_STORAGE_KEY = "athas_collaboration_device_id";
const COLLABORATION_CLIENT_SEQ_STORAGE_KEY = "athas_collaboration_client_seq";

interface CollaborationDocumentUpdatePull {
  document: {
    id: number;
    path: string;
    baseVersion: number;
    stateVector: Record<string, unknown>;
    updatedAt: string | null;
  };
  updates: Array<{
    id: number;
    documentId: number;
    actorUserId: number | null;
    clientId: string;
    clientSeq: number;
    serverVersion: number;
    updateType: string;
    operation: Record<string, unknown>;
    createdAt: string | null;
  }>;
}

export type CollaborationDocumentSnapshot = CollaborationDocumentUpdatePull["document"];
export type CollaborationDocumentUpdate = CollaborationDocumentUpdatePull["updates"][number];

export type CollaborationDocumentStreamEvent =
  | {
      type: "ready";
      document: CollaborationDocumentSnapshot;
      afterServerVersion: number;
      pollIntervalMs: number;
    }
  | {
      type: "update";
      document: CollaborationDocumentSnapshot;
      update: CollaborationDocumentUpdate;
    }
  | {
      type: "heartbeat";
      document: CollaborationDocumentSnapshot;
      afterServerVersion: number;
    }
  | {
      type: "error";
      error: string;
      status?: number;
    };

function getCollaborationDeviceId(): string {
  if (collaborationDeviceIdCache) return collaborationDeviceIdCache;

  const existing = window.localStorage.getItem(COLLABORATION_DEVICE_ID_STORAGE_KEY);
  if (existing) {
    collaborationDeviceIdCache = existing;
    return existing;
  }

  const next = crypto.randomUUID();
  window.localStorage.setItem(COLLABORATION_DEVICE_ID_STORAGE_KEY, next);
  collaborationDeviceIdCache = next;
  return next;
}

export function getCollaborationClientId(): string {
  return getCollaborationDeviceId();
}

export function getNextCollaborationClientSeq(): number {
  const current = Number(window.localStorage.getItem(COLLABORATION_CLIENT_SEQ_STORAGE_KEY) ?? 0);
  const next = Number.isFinite(current) && current >= 0 ? Math.floor(current) + 1 : 1;
  window.localStorage.setItem(COLLABORATION_CLIENT_SEQ_STORAGE_KEY, String(next));
  return next;
}

export async function updateCollaborationPresence(input: {
  status?: "online" | "away" | "offline";
  channelId?: number | null;
  followingUserId?: number | null;
  activeFilePath?: string | null;
  cursorLabel?: string | null;
}): Promise<SubscriptionInfo["collaboration"] | null> {
  const response = await authenticatedFetch("/api/collaboration/presence", {
    method: "POST",
    body: JSON.stringify({
      deviceId: getCollaborationDeviceId(),
      status: input.status ?? "online",
      channelId: input.channelId ?? null,
      followingUserId: input.followingUserId ?? null,
      activeFilePath: input.activeFilePath ?? null,
      cursorLabel: input.cursorLabel ?? null,
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    collaboration?: SubscriptionInfo["collaboration"];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to update collaboration presence: ${response.status}`,
      response.status,
    );
  }

  return payload?.collaboration ?? null;
}

export async function updateCollaborationChannelNote(input: {
  channelId: number;
  contentMarkdown: string;
}): Promise<SubscriptionInfo["collaboration"] | null> {
  const response = await authenticatedFetch(
    `/api/collaboration/channels/${input.channelId}/notes`,
    {
      method: "PATCH",
      body: JSON.stringify({
        contentMarkdown: input.contentMarkdown,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    collaboration?: SubscriptionInfo["collaboration"];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to update collaboration channel note: ${response.status}`,
      response.status,
    );
  }

  return payload?.collaboration ?? null;
}

export async function createCollaborationChannel(input: {
  name: string;
  description?: string;
  visibility?: string;
}): Promise<SubscriptionInfo["collaboration"] | null> {
  const response = await authenticatedFetch("/api/collaboration/channels", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      visibility: input.visibility ?? "workspace",
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    collaboration?: SubscriptionInfo["collaboration"];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to create collaboration channel: ${response.status}`,
      response.status,
    );
  }

  return payload?.collaboration ?? null;
}

export async function appendCollaborationPrivateChatMessage(input: {
  memberId: number;
  body: string;
}): Promise<SubscriptionInfo["collaboration"] | null> {
  const response = await authenticatedFetch(
    `/api/collaboration/private-chats/${input.memberId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        body: input.body,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    collaboration?: SubscriptionInfo["collaboration"];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to send private chat message: ${response.status}`,
      response.status,
    );
  }

  return payload?.collaboration ?? null;
}

export type CollaborationMediaSignal = NonNullable<
  SubscriptionInfo["collaboration"]
>["mediaSignals"][number];

export async function fetchCollaborationMediaSignals(input: {
  channelId: number;
  afterId?: number;
  deviceId: string;
}): Promise<CollaborationMediaSignal[]> {
  const params = new URLSearchParams({
    afterId: String(input.afterId ?? 0),
    deviceId: input.deviceId,
  });
  const response = await authenticatedFetch(
    `/api/collaboration/channels/${input.channelId}/media/signals?${params.toString()}`,
  );

  const payload = (await response.json().catch(() => null)) as {
    signals?: CollaborationMediaSignal[];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to fetch collaboration media signals: ${response.status}`,
      response.status,
    );
  }

  return payload?.signals ?? [];
}

export async function postCollaborationMediaSignal(input: {
  channelId: number;
  senderDeviceId: string;
  recipientDeviceId?: string | null;
  kind: "offer" | "answer" | "ice" | "leave";
  payload: Record<string, unknown>;
}): Promise<CollaborationMediaSignal | null> {
  const response = await authenticatedFetch(
    `/api/collaboration/channels/${input.channelId}/media/signals`,
    {
      method: "POST",
      body: JSON.stringify({
        senderDeviceId: input.senderDeviceId,
        recipientDeviceId: input.recipientDeviceId ?? null,
        kind: input.kind,
        payload: input.payload,
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    signal?: CollaborationMediaSignal;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to post collaboration media signal: ${response.status}`,
      response.status,
    );
  }

  return payload?.signal ?? null;
}

export async function registerCollaborationDocument(input: {
  path: string;
  baseVersion?: number;
  stateVector?: Record<string, unknown>;
}): Promise<SubscriptionInfo["collaboration"] | null> {
  const response = await authenticatedFetch("/api/collaboration/documents", {
    method: "POST",
    body: JSON.stringify({
      path: input.path,
      baseVersion: input.baseVersion ?? 0,
      stateVector: input.stateVector ?? {},
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    collaboration?: SubscriptionInfo["collaboration"];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to register collaboration document: ${response.status}`,
      response.status,
    );
  }

  return payload?.collaboration ?? null;
}

export async function appendCollaborationDocumentUpdate(input: {
  documentId: number;
  clientId: string;
  clientSeq: number;
  expectedBaseVersion?: number;
  updateType?: "metadata" | "cursor" | "content";
  operation?: Record<string, unknown>;
}): Promise<SubscriptionInfo["collaboration"] | null> {
  const response = await authenticatedFetch(
    `/api/collaboration/documents/${input.documentId}/updates`,
    {
      method: "POST",
      body: JSON.stringify({
        clientId: input.clientId,
        clientSeq: input.clientSeq,
        expectedBaseVersion: input.expectedBaseVersion,
        updateType: input.updateType ?? "metadata",
        operation: input.operation ?? {},
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as {
    collaboration?: SubscriptionInfo["collaboration"];
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error || `Failed to append collaboration document update: ${response.status}`,
      response.status,
    );
  }

  return payload?.collaboration ?? null;
}

function toCollaborationDocumentStreamEvent(
  eventName: string,
  data: Record<string, unknown>,
): CollaborationDocumentStreamEvent | null {
  if (eventName === "ready" && data.document) {
    return {
      type: "ready",
      document: data.document as CollaborationDocumentSnapshot,
      afterServerVersion: typeof data.afterServerVersion === "number" ? data.afterServerVersion : 0,
      pollIntervalMs: typeof data.pollIntervalMs === "number" ? data.pollIntervalMs : 2000,
    };
  }

  if (eventName === "update" && data.document && data.update) {
    return {
      type: "update",
      document: data.document as CollaborationDocumentSnapshot,
      update: data.update as CollaborationDocumentUpdate,
    };
  }

  if (eventName === "heartbeat" && data.document) {
    return {
      type: "heartbeat",
      document: data.document as CollaborationDocumentSnapshot,
      afterServerVersion: typeof data.afterServerVersion === "number" ? data.afterServerVersion : 0,
    };
  }

  if (eventName === "error") {
    return {
      type: "error",
      error: typeof data.error === "string" ? data.error : "Collaboration stream failed",
      status: typeof data.status === "number" ? data.status : undefined,
    };
  }

  return null;
}

function parseCollaborationSseBlock(block: string): CollaborationDocumentStreamEvent | null {
  const lines = block.split("\n");
  const eventName = lines
    .find((line) => line.startsWith("event:"))
    ?.slice("event:".length)
    .trim();
  const dataText = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  if (!eventName || !dataText) return null;

  const data = JSON.parse(dataText) as unknown;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  return toCollaborationDocumentStreamEvent(eventName, data as Record<string, unknown>);
}

export async function streamCollaborationDocumentUpdates(input: {
  documentId: number;
  afterVersion?: number;
  limit?: number;
  maxPolls?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  onEvent: (event: CollaborationDocumentStreamEvent) => void | Promise<void>;
}): Promise<void> {
  const params = new URLSearchParams({
    afterVersion: String(input.afterVersion ?? 0),
    limit: String(input.limit ?? 100),
  });
  if (typeof input.maxPolls === "number") params.set("maxPolls", String(input.maxPolls));
  if (typeof input.pollIntervalMs === "number") {
    params.set("pollIntervalMs", String(input.pollIntervalMs));
  }

  const response = await authenticatedFetch(
    `/api/collaboration/documents/${input.documentId}/events?${params.toString()}`,
    {
      headers: { Accept: "text/event-stream" },
      signal: input.signal,
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new AuthApiError(
      payload?.error || `Failed to stream collaboration document updates: ${response.status}`,
      response.status,
    );
  }

  if (!response.body) {
    throw new AuthApiError("Collaboration document update stream is unavailable.", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const event = parseCollaborationSseBlock(block.trim());
      if (event) await input.onEvent(event);
    }

    if (done) break;
  }

  const trailingEvent = parseCollaborationSseBlock(buffer.trim());
  if (trailingEvent) await input.onEvent(trailingEvent);
}

export const __test__ = {
  parseCollaborationSseBlock,
};
