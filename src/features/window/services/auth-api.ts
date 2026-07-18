import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { DEFAULT_API_BASE, getApiBase, isLocalApiBase } from "@/utils/api-base";

const API_BASE = getApiBase();
const DESKTOP_AUTH_POLL_INTERVAL_MS = 1500;
const DESKTOP_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DESKTOP_SESSION_SECRET_HEADER = "X-Desktop-Session-Secret";
const AUTH_API_BASE_STORAGE_KEY = "athas_auth_api_base";
let authTokenCache: string | null | undefined;
let authApiBaseCache: string | null | undefined;
let collaborationDeviceIdCache: string | null = null;
const COLLABORATION_DEVICE_ID_STORAGE_KEY = "athas_collaboration_device_id";
const COLLABORATION_CLIENT_SEQ_STORAGE_KEY = "athas_collaboration_client_seq";

interface DesktopAuthApiOptions {
  apiBase?: string;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  provider: string | null;
  github_username: string | null;
  subscription_status: "free" | "pro";
  subscriptionStatus?: "free" | "pro";
  subscriptionPlan?: "free" | "pro" | "teams" | "enterprise";
  created_at: string;
}

export type ProductCapability = "hostedAi" | "settingsSync" | "collaboration" | "enterprisePolicy";

export type ProductCapabilities = Record<ProductCapability, boolean>;

export interface SubscriptionInfo {
  status: "free" | "pro";
  capabilities?: ProductCapabilities;
  subscription: {
    plan: "free" | "pro" | "teams" | "enterprise" | string;
    renews_at: string | null;
    ends_at: string | null;
  } | null;
  collaboration?: {
    enabled: boolean;
    workspace: {
      id: number;
      name: string;
      slug: string;
      role: string;
      visibility: string;
      realtimeProtocolVersion: number;
    } | null;
    members: Array<{
      id: number;
      userId: number | null;
      name: string;
      email: string;
      role: string;
      status: string;
      lastSeenAt: string | null;
    }>;
    invitations: Array<{
      id: number;
      email: string;
      role: string;
      status: string;
      expiresAt: string | null;
    }>;
    projects: Array<{
      id: number;
      name: string;
      visibility: string;
      updatedAt: string | null;
    }>;
    channels: Array<{
      id: number;
      name: string;
      slug: string;
      description: string | null;
      visibility: string;
      parentChannelId: number | null;
      memberCount: number;
      guestCount: number;
      noteVersion: number;
      notePreview: string;
      updatedAt: string | null;
    }>;
    channelNotes: Array<{
      channelId: number;
      contentMarkdown: string;
      version: number;
      updatedAt: string | null;
    }>;
    privateChats: Array<{
      id: number;
      conversationMemberId: number;
      authorMemberId: number;
      body: string;
      createdAt: string | null;
    }>;
    channelGuests: Array<{
      id: number;
      channelId: number;
      email: string;
      name: string;
      role: string;
      status: string;
      expiresAt: string | null;
    }>;
    settings: {
      sharedSettings: Record<string, unknown>;
      editorPolicy: Record<string, unknown>;
    } | null;
    activity: Array<{
      id: number;
      action: string;
      actorUserId: number | null;
      targetType: string | null;
      targetId: string | null;
      metadata: Record<string, unknown>;
      createdAt: string | null;
    }>;
    presence: Array<{
      id: number;
      userId: number | null;
      channelId: number | null;
      channelName: string | null;
      channelSlug: string | null;
      followingUserId: number | null;
      followingUserName: string | null;
      deviceId: string;
      status: string;
      activeFilePath: string | null;
      cursorLabel: string | null;
      heartbeatAt: string | null;
    }>;
    documents: Array<{
      id: number;
      path: string;
      baseVersion: number;
      stateVector: Record<string, unknown>;
      updatedAt: string | null;
    }>;
    documentUpdates: Array<{
      id: number;
      documentId: number;
      clientId: string;
      clientSeq: number;
      serverVersion: number;
      updateType: string;
      createdAt: string | null;
    }>;
    mediaSignals: Array<{
      id: number;
      channelId: number;
      senderDeviceId: string;
      recipientDeviceId: string | null;
      kind: "offer" | "answer" | "ice" | "leave" | string;
      payload: Record<string, unknown>;
      createdAt: string | null;
    }>;
    capabilities: {
      canInvite: boolean;
      canManageMembers: boolean;
      canShareProjects: boolean;
      canCreateChannels: boolean;
      canEditChannelNotes: boolean;
      activityFeed: boolean;
      presence: boolean;
      realtimeDocuments: boolean;
    };
  } | null;
  enterprise: {
    has_access: boolean;
    is_admin: boolean;
    policy: {
      managedMode: boolean;
      requireExtensionAllowlist: boolean;
      allowedExtensionIds: string[];
      allowByok: boolean;
      aiCompletionEnabled: boolean;
      aiChatEnabled: boolean;
      updatedAt: string | null;
    } | null;
  };
  autocomplete?: {
    usage?: Record<string, unknown> | null;
  } | null;
}

export interface EnterprisePolicy {
  managedMode: boolean;
  requireExtensionAllowlist: boolean;
  allowedExtensionIds: string[];
  allowByok: boolean;
  aiCompletionEnabled: boolean;
  aiChatEnabled: boolean;
  updatedAt: string | null;
}

export interface CollaborationDocumentUpdatePull {
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

export interface CollaborationAdminAnalytics {
  generatedAt: string;
  workspace: {
    id: number;
    name: string;
    slug: string;
  };
  totals: {
    members: number;
    activeMembers: number;
    pendingInvitations: number;
    channels: number;
    projects: number;
    presenceSessions: number;
    documents: number;
    documentUpdates: number;
    activityEvents: number;
  };
  roles: Record<string, number>;
  memberStatuses: Record<string, number>;
  updateTypes: Record<string, number>;
  recentActivity: Array<{
    id: number;
    action: string;
    actorUserId: number | null;
    targetType: string | null;
    targetId: string | null;
    createdAt: string | null;
  }>;
}

export interface CloudSettingsSyncSnapshot {
  schemaVersion: number;
  updatedAt: string;
  settings: Record<string, unknown>;
}

type DesktopAuthPollResponse =
  | { status: "pending" }
  | { status: "ready"; token: string }
  | { status: "expired" }
  | { status: "missing" };

type DesktopAuthInitResponse = {
  sessionId?: unknown;
  pollSecret?: unknown;
  loginUrl?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseSubscriptionInfoResponse(payload: unknown): SubscriptionInfo | null {
  if (!isRecord(payload)) return null;
  if (payload.status !== "free" && payload.status !== "pro") return null;

  const subscription = parseSubscriptionPlanSnapshot(payload.subscription);
  const enterprise = asRecord(payload.enterprise);
  const collaboration = parseCollaborationSnapshot(payload.collaboration);
  const capabilities = asRecord(payload.capabilities);

  return {
    ...(payload as unknown as SubscriptionInfo),
    status: payload.status,
    capabilities: {
      hostedAi:
        typeof capabilities.hostedAi === "boolean"
          ? capabilities.hostedAi
          : payload.status === "pro",
      settingsSync:
        typeof capabilities.settingsSync === "boolean"
          ? capabilities.settingsSync
          : payload.status === "pro",
      collaboration:
        typeof capabilities.collaboration === "boolean"
          ? capabilities.collaboration
          : collaboration?.enabled === true,
      enterprisePolicy:
        typeof capabilities.enterprisePolicy === "boolean"
          ? capabilities.enterprisePolicy
          : enterprise.has_access === true,
    },
    subscription,
    collaboration,
    enterprise: {
      has_access: enterprise.has_access === true,
      is_admin: enterprise.is_admin === true,
      policy: isRecord(enterprise.policy)
        ? (enterprise.policy as SubscriptionInfo["enterprise"]["policy"])
        : null,
    },
  };
}

function parseSubscriptionPlanSnapshot(payload: unknown): SubscriptionInfo["subscription"] | null {
  if (payload === null || payload === undefined) return null;
  if (!isRecord(payload) || typeof payload.plan !== "string") return null;

  return {
    plan: payload.plan,
    renews_at: typeof payload.renews_at === "string" ? payload.renews_at : null,
    ends_at: typeof payload.ends_at === "string" ? payload.ends_at : null,
  };
}

function parseCollaborationSnapshot(payload: unknown): SubscriptionInfo["collaboration"] | null {
  if (payload === null || payload === undefined) return null;
  if (!isRecord(payload) || typeof payload.enabled !== "boolean") return null;

  const capabilities = asRecord(payload.capabilities);
  const settings = asRecord(payload.settings);

  return {
    enabled: payload.enabled,
    workspace: isRecord(payload.workspace)
      ? (payload.workspace as NonNullable<SubscriptionInfo["collaboration"]>["workspace"])
      : null,
    members: asArray(payload.members) as NonNullable<SubscriptionInfo["collaboration"]>["members"],
    invitations: asArray(payload.invitations) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["invitations"],
    projects: asArray(payload.projects) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["projects"],
    channels: asArray(payload.channels) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["channels"],
    channelNotes: asArray(payload.channelNotes) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["channelNotes"],
    privateChats: asArray(payload.privateChats) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["privateChats"],
    channelGuests: asArray(payload.channelGuests) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["channelGuests"],
    settings:
      isRecord(settings.sharedSettings) || isRecord(settings.editorPolicy)
        ? {
            sharedSettings: asRecord(settings.sharedSettings),
            editorPolicy: asRecord(settings.editorPolicy),
          }
        : null,
    activity: asArray(payload.activity) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["activity"],
    presence: asArray(payload.presence) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["presence"],
    documents: asArray(payload.documents) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["documents"],
    documentUpdates: asArray(payload.documentUpdates) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["documentUpdates"],
    mediaSignals: asArray(payload.mediaSignals) as NonNullable<
      SubscriptionInfo["collaboration"]
    >["mediaSignals"],
    capabilities: {
      canInvite: capabilities.canInvite === true,
      canManageMembers: capabilities.canManageMembers === true,
      canShareProjects: capabilities.canShareProjects === true,
      canCreateChannels: capabilities.canCreateChannels === true,
      canEditChannelNotes: capabilities.canEditChannelNotes === true,
      activityFeed: capabilities.activityFeed === true,
      presence: capabilities.presence === true,
      realtimeDocuments: capabilities.realtimeDocuments === true,
    },
  };
}

export class DesktopAuthError extends Error {
  code: "endpoint_unavailable" | "expired" | "timeout" | "failed";

  constructor(code: DesktopAuthError["code"], message: string) {
    super(message);
    this.name = "DesktopAuthError";
    this.code = code;
  }
}

export class AuthApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isAuthInvalidError(error: unknown): boolean {
  return error instanceof AuthApiError && (error.status === 401 || error.status === 403);
}

function getApiBaseUnavailableMessage(apiBase = API_BASE): string {
  if (isLocalApiBase(apiBase)) {
    return `Could not reach local auth server at ${apiBase}. Start the local web app/server first, then try sign-in again.`;
  }

  return `Could not reach auth server at ${apiBase}.`;
}

function normalizeApiBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, "");
}

function getStoredAuthApiBase(): string | null {
  if (authApiBaseCache !== undefined) return authApiBaseCache;
  if (typeof window === "undefined") {
    authApiBaseCache = null;
    return authApiBaseCache;
  }

  try {
    const value = window.localStorage.getItem(AUTH_API_BASE_STORAGE_KEY)?.trim();
    authApiBaseCache = value ? normalizeApiBase(value) : null;
  } catch {
    authApiBaseCache = null;
  }

  return authApiBaseCache;
}

function rememberAuthApiBase(apiBase: string): void {
  const normalized = normalizeApiBase(apiBase);
  authApiBaseCache = normalized;

  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_API_BASE_STORAGE_KEY, normalized);
  } catch {
    // Auth still works without localStorage; the in-memory cache covers this session.
  }
}

function clearAuthApiBase(): void {
  authApiBaseCache = null;

  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AUTH_API_BASE_STORAGE_KEY);
  } catch {
    // Ignore storage failures while clearing local auth state.
  }
}

function getPreferredAuthApiBase(apiBase?: string): string {
  return normalizeApiBase(apiBase ?? getStoredAuthApiBase() ?? API_BASE);
}

function getAuthApiBaseCandidates(apiBase?: string): string[] {
  const preferred = getPreferredAuthApiBase(apiBase);
  const candidates = [preferred];
  const productionBase = normalizeApiBase(DEFAULT_API_BASE);

  if (isLocalApiBase(preferred) && preferred !== productionBase) {
    candidates.push(productionBase);
  }

  return candidates;
}

function shouldFallbackFromAuthApiBase(apiBase: string): boolean {
  return (
    isLocalApiBase(apiBase) && normalizeApiBase(apiBase) !== normalizeApiBase(DEFAULT_API_BASE)
  );
}

function shouldTryNextAuthApiBase(apiBase: string, status: number): boolean {
  return (
    shouldFallbackFromAuthApiBase(apiBase) && (status === 401 || status === 403 || status === 404)
  );
}

// Secure token storage via Rust backend
export const getAuthToken = async (): Promise<string | null> => {
  if (authTokenCache !== undefined) {
    return authTokenCache;
  }

  try {
    authTokenCache = await invoke<string | null>("get_auth_token");
    return authTokenCache;
  } catch {
    return null;
  }
};

export const storeAuthToken = async (token: string): Promise<void> => {
  await invoke("store_auth_token", { token });
  authTokenCache = token;
};

export const removeAuthToken = async (): Promise<void> => {
  authTokenCache = null;
  clearAuthApiBase();
  await invoke("remove_auth_token");
};

// Authenticated API fetch helper
async function authenticatedFetch(
  path: string,
  options: RequestInit = {},
  tokenOverride?: string,
): Promise<Response> {
  const token = tokenOverride ?? (await getAuthToken());
  if (!token) {
    throw new Error("Not authenticated");
  }

  const requestOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  };

  let fallbackError: unknown = null;
  for (const apiBase of getAuthApiBaseCandidates()) {
    try {
      const response = await tauriFetch(`${apiBase}${path}`, requestOptions);
      if (shouldTryNextAuthApiBase(apiBase, response.status)) {
        fallbackError = new AuthApiError(
          `Auth request was rejected at ${apiBase}: ${response.status}`,
          response.status,
        );
        continue;
      }

      rememberAuthApiBase(apiBase);
      return response;
    } catch (error) {
      fallbackError = error;
      if (!shouldFallbackFromAuthApiBase(apiBase)) {
        throw error;
      }
    }
  }

  throw fallbackError instanceof Error
    ? fallbackError
    : new Error(getApiBaseUnavailableMessage(getPreferredAuthApiBase()));
}

export async function fetchCurrentUser(tokenOverride?: string): Promise<AuthUser> {
  const response = await authenticatedFetch("/api/auth/me", {}, tokenOverride);
  if (!response.ok) {
    throw new AuthApiError(`Failed to fetch user: ${response.status}`, response.status);
  }
  const data = await response.json();
  if (!data.user) {
    throw new AuthApiError("Authentication token did not resolve to a user.", 401);
  }
  return data.user;
}

export async function fetchSubscriptionStatus(tokenOverride?: string): Promise<SubscriptionInfo> {
  const response = await authenticatedFetch("/api/auth/subscription", {}, tokenOverride);
  if (!response.ok) {
    throw new AuthApiError(`Failed to fetch subscription: ${response.status}`, response.status);
  }
  const parsed = parseSubscriptionInfoResponse(await response.json());
  if (!parsed) {
    throw new AuthApiError("Subscription response was malformed.", response.status);
  }
  return parsed;
}

export async function updateEnterprisePolicy(
  patch: Partial<Omit<EnterprisePolicy, "updatedAt">>,
): Promise<EnterprisePolicy> {
  const response = await authenticatedFetch("/api/enterprise/policy", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  const payload = (await response.json().catch(() => null)) as {
    policy?: EnterprisePolicy;
    error?: string;
  } | null;

  if (!response.ok || !payload?.policy) {
    throw new Error(payload?.error || `Failed to update enterprise policy: ${response.status}`);
  }

  return payload.policy;
}

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

export async function fetchCollaborationDocumentUpdates(input: {
  documentId: number;
  afterVersion?: number;
  limit?: number;
}): Promise<CollaborationDocumentUpdatePull> {
  const params = new URLSearchParams({
    afterVersion: String(input.afterVersion ?? 0),
    limit: String(input.limit ?? 100),
  });
  const response = await authenticatedFetch(
    `/api/collaboration/documents/${input.documentId}/updates?${params.toString()}`,
  );

  const payload = (await response.json().catch(() => null)) as
    | (CollaborationDocumentUpdatePull & { error?: string })
    | null;

  if (!response.ok || !payload?.document) {
    throw new AuthApiError(
      payload?.error || `Failed to fetch collaboration document updates: ${response.status}`,
      response.status,
    );
  }

  return {
    document: payload.document,
    updates: payload.updates ?? [],
  };
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

export async function fetchCollaborationAdminAnalytics(): Promise<CollaborationAdminAnalytics> {
  const response = await authenticatedFetch("/api/collaboration/admin/analytics");
  const payload = (await response.json().catch(() => null)) as {
    analytics?: CollaborationAdminAnalytics;
    error?: string;
  } | null;

  if (!response.ok || !payload?.analytics) {
    throw new AuthApiError(
      payload?.error || `Failed to fetch collaboration analytics: ${response.status}`,
      response.status,
    );
  }

  return payload.analytics;
}

export async function fetchSettingsSyncSnapshot(
  tokenOverride?: string,
): Promise<CloudSettingsSyncSnapshot | null> {
  const response = await authenticatedFetch("/api/account/settings-sync", {}, tokenOverride);

  const data = (await response.json().catch(() => null)) as {
    snapshot?: CloudSettingsSyncSnapshot | null;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new AuthApiError(
      data?.error || `Failed to fetch settings sync snapshot: ${response.status}`,
      response.status,
    );
  }

  return data?.snapshot ?? null;
}

export async function pushSettingsSyncSnapshot(input: {
  schemaVersion: number;
  settings: Record<string, unknown>;
}): Promise<CloudSettingsSyncSnapshot> {
  const response = await authenticatedFetch("/api/account/settings-sync", {
    method: "PUT",
    body: JSON.stringify(input),
  });

  const data = (await response.json().catch(() => null)) as {
    snapshot?: CloudSettingsSyncSnapshot;
    error?: string;
  } | null;

  if (!response.ok || !data?.snapshot) {
    throw new AuthApiError(
      data?.error || `Failed to update settings sync snapshot: ${response.status}`,
      response.status,
    );
  }

  return data.snapshot;
}

export async function logoutFromServer(): Promise<void> {
  try {
    await authenticatedFetch("/api/auth/logout", { method: "DELETE" });
  } catch {
    // Even if server logout fails, we still clear the local token
  }
}

export async function beginDesktopAuthSession(options: DesktopAuthApiOptions = {}): Promise<{
  sessionId: string;
  pollSecret: string;
  loginUrl: string;
  apiBase: string;
}> {
  let fallbackError: DesktopAuthError | null = null;

  for (const apiBase of getAuthApiBaseCandidates(options.apiBase)) {
    let response: Response;
    try {
      response = await tauriFetch(`${apiBase}/api/auth/desktop/session/init`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      fallbackError = new DesktopAuthError(
        "failed",
        error instanceof Error
          ? `${getApiBaseUnavailableMessage(apiBase)} ${error.message}`
          : getApiBaseUnavailableMessage(apiBase),
      );

      if (shouldFallbackFromAuthApiBase(apiBase)) {
        continue;
      }

      throw fallbackError;
    }

    if (response.status === 404) {
      fallbackError = new DesktopAuthError(
        "endpoint_unavailable",
        "Desktop auth session endpoint is unavailable on this server.",
      );

      if (shouldFallbackFromAuthApiBase(apiBase)) {
        continue;
      }

      throw fallbackError;
    }

    if (!response.ok) {
      throw new DesktopAuthError(
        "failed",
        `Failed to initialize desktop sign-in (${response.status}).`,
      );
    }

    const payload = (await response.json()) as DesktopAuthInitResponse;
    const parsed = parseDesktopAuthInitResponse(payload);
    if (!parsed) {
      throw new DesktopAuthError("failed", "Invalid desktop sign-in initialization response.");
    }

    return {
      ...parsed,
      apiBase,
    };
  }

  throw (
    fallbackError ??
    new DesktopAuthError(
      "failed",
      getApiBaseUnavailableMessage(getPreferredAuthApiBase(options.apiBase)),
    )
  );
}

function parseDesktopAuthInitResponse(payload: unknown): {
  sessionId: string;
  pollSecret: string;
  loginUrl: string;
} | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as {
    sessionId?: unknown;
    pollSecret?: unknown;
    loginUrl?: unknown;
  };

  if (
    typeof candidate.sessionId !== "string" ||
    typeof candidate.pollSecret !== "string" ||
    typeof candidate.loginUrl !== "string"
  ) {
    return null;
  }

  if (!candidate.sessionId || !candidate.pollSecret || !candidate.loginUrl) {
    return null;
  }

  return {
    sessionId: candidate.sessionId,
    pollSecret: candidate.pollSecret,
    loginUrl: candidate.loginUrl,
  };
}

function parseDesktopAuthPollResponse(payload: unknown): DesktopAuthPollResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const status = (payload as { status?: unknown }).status;
  if (status === "pending" || status === "expired" || status === "missing") {
    return { status };
  }
  if (status === "ready") {
    const token = (payload as { token?: unknown }).token;
    if (typeof token === "string" && token.length > 0) {
      return { status: "ready", token };
    }
  }
  return null;
}

export async function waitForDesktopAuthToken(
  sessionId: string,
  pollSecret: string,
  timeoutMs = DESKTOP_AUTH_TIMEOUT_MS,
  options: DesktopAuthApiOptions = {},
): Promise<string> {
  const apiBase = getPreferredAuthApiBase(options.apiBase);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const url = `${apiBase}/api/auth/desktop/session?session=${encodeURIComponent(sessionId)}`;
    let response: Response;
    try {
      response = await tauriFetch(url, {
        method: "GET",
        headers: {
          [DESKTOP_SESSION_SECRET_HEADER]: pollSecret,
        },
      });
    } catch (error) {
      throw new DesktopAuthError(
        "failed",
        error instanceof Error
          ? `${getApiBaseUnavailableMessage(apiBase)} ${error.message}`
          : getApiBaseUnavailableMessage(apiBase),
      );
    }

    if (response.status === 404) {
      throw new DesktopAuthError(
        "endpoint_unavailable",
        "Desktop auth session endpoint is unavailable on this server.",
      );
    }

    if (response.status === 410) {
      throw new DesktopAuthError("expired", "Desktop sign-in session expired.");
    }

    if (!response.ok) {
      throw new DesktopAuthError("failed", `Desktop sign-in failed (${response.status}).`);
    }

    const payload = await response.json();
    const parsed = parseDesktopAuthPollResponse(payload);

    if (!parsed) {
      throw new DesktopAuthError("failed", "Invalid desktop sign-in response.");
    }

    if (parsed.status === "ready") {
      rememberAuthApiBase(apiBase);
      return parsed.token;
    }

    if (parsed.status === "expired") {
      throw new DesktopAuthError("expired", "Desktop sign-in session is no longer valid.");
    }

    if (parsed.status === "missing") {
      throw new DesktopAuthError(
        "failed",
        "Desktop sign-in session credentials are invalid or the session has expired.",
      );
    }

    await sleep(DESKTOP_AUTH_POLL_INTERVAL_MS);
  }

  throw new DesktopAuthError("timeout", "Desktop sign-in timed out. Please try again.");
}

export const __test__ = {
  parseDesktopAuthInitResponse,
  parseDesktopAuthPollResponse,
  parseSubscriptionInfoResponse,
  parseCollaborationSseBlock,
  getApiBaseUnavailableMessage,
  getAuthApiBaseCandidates,
  shouldTryNextAuthApiBase,
};
