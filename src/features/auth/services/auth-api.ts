import { commands } from "@/bindings/commands";
import { tauriFetch } from "@/utils/tauri-fetch";
import { getApiBase, isLocalApiBase } from "@/utils/api-base";

const API_BASE = getApiBase();
const DESKTOP_AUTH_POLL_INTERVAL_MS = 1500;
const DESKTOP_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DESKTOP_SESSION_SECRET_HEADER = "X-Desktop-Session-Secret";
let authTokenCache: string | null | undefined;

interface DesktopAuthApiOptions {
  apiBase?: string;
  signal?: AbortSignal;
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

export type ProductCapability =
  | "intelligence"
  | "hostedAi"
  | "settingsSync"
  | "cloudWorkspaces"
  | "collaboration"
  | "enterprisePolicy";

type ProductCapabilities = Record<ProductCapability, boolean>;

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
  /**
   * This billing period's included hosted AI credit and the prepaid balance, all in USD cents
   * billed at list price plus the usage markup. Absent on older servers.
   */
  intelligence?: {
    credits?: IntelligenceCredits | null;
  } | null;
}

export interface IntelligenceCredits {
  periodStart: string;
  periodEnd: string;
  allowanceCents: number;
  usedCents: number;
  pendingCents: number;
  remainingCents: number;
  requestsCount: number;
  /** List price multiplier hosted requests are billed at (1.1 = plus 10%), when reported. */
  usageMarkup?: number | null;
  /**
   * Spendable prepaid balance hosted turns draw from after the included credit, with in-flight
   * holds subtracted. Null when the server has no prepaid balance enabled.
   */
  walletBalanceCents?: number | null;
}

interface EnterprisePolicy {
  managedMode: boolean;
  requireExtensionAllowlist: boolean;
  allowedExtensionIds: string[];
  allowByok: boolean;
  aiCompletionEnabled: boolean;
  aiChatEnabled: boolean;
  updatedAt: string | null;
}

type DesktopAuthPollResponse =
  | { status: "pending" }
  | { status: "ready"; token: string }
  | { status: "expired" }
  | { status: "missing" };

type DesktopAuthInitResponse = {
  sessionId: string;
  pollSecret: string;
  loginUrl: string;
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
      intelligence:
        typeof capabilities.intelligence === "boolean"
          ? capabilities.intelligence
          : typeof capabilities.hostedAi === "boolean"
            ? capabilities.hostedAi
            : payload.status === "pro",
      hostedAi:
        typeof capabilities.hostedAi === "boolean"
          ? capabilities.hostedAi
          : typeof capabilities.intelligence === "boolean"
            ? capabilities.intelligence
            : payload.status === "pro",
      settingsSync:
        typeof capabilities.settingsSync === "boolean"
          ? capabilities.settingsSync
          : payload.status === "pro",
      cloudWorkspaces:
        typeof capabilities.cloudWorkspaces === "boolean"
          ? capabilities.cloudWorkspaces
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

class DesktopAuthError extends Error {
  code: "endpoint_unavailable" | "expired" | "timeout" | "failed";

  constructor(code: DesktopAuthError["code"], message: string) {
    super(message);
    this.name = "DesktopAuthError";
    this.code = code;
  }
}

export class AuthApiError extends Error {
  status: number;
  /** The server's error code from the response body, when it sent one. */
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

/** Codes a 403 carries when the saved session itself is no longer accepted. */
const INVALID_SESSION_CODES = new Set([
  "invalid_session",
  "session_invalid",
  "session_revoked",
  "session_expired",
  "token_revoked",
]);

async function readAuthErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body)) return undefined;
    const nested = isRecord(body.error) ? body.error : null;
    const code = nested?.code ?? body.code;
    if (typeof code === "string" && code) return code;
    return body.sessionInvalid === true ? "invalid_session" : undefined;
  } catch {
    return undefined;
  }
}

async function authApiError(message: string, response: Response): Promise<AuthApiError> {
  return new AuthApiError(message, response.status, await readAuthErrorCode(response));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/**
 * Whether a failure means the saved session is gone. A plain 403 is a permission answer
 * (a plan, a team policy) and must not sign the user out; only 401, or a 403 whose body
 * marks the session invalid, does.
 */
export function isAuthInvalidError(error: unknown): boolean {
  if (!(error instanceof AuthApiError)) return false;
  if (error.status === 401) return true;
  return error.status === 403 && error.code !== undefined && INVALID_SESSION_CODES.has(error.code);
}

/**
 * Why a saved session could not be checked, when the answer was not "the session is invalid".
 * `local_server_down` is a development build pointed at a local server that is not running.
 */
export interface SessionCheckFailure {
  reason: "unreachable" | "local_server_down" | "timeout" | "server_error";
  /** One line saying what actually happened, naming the host that was asked. */
  message: string;
  host: string;
}

function describeApiHost(apiBase: string): string {
  try {
    return new URL(apiBase).host || apiBase;
  } catch {
    return apiBase;
  }
}

export function describeSessionCheckFailure(
  error: unknown,
  apiBase: string = API_BASE,
): SessionCheckFailure {
  const host = describeApiHost(apiBase);
  if (error instanceof AuthApiError) {
    return {
      reason: "server_error",
      message:
        error.status >= 500
          ? `${host} had a server error (${error.status}).`
          : `${host} gave an unexpected answer (${error.status}).`,
      host,
    };
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return { reason: "timeout", message: `${host} did not answer in time.`, host };
  }
  if (isLocalApiBase(apiBase)) {
    return {
      reason: "local_server_down",
      message: `Nothing is answering at ${host}.`,
      host,
    };
  }
  return { reason: "unreachable", message: `Could not reach ${host}.`, host };
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

function getPreferredAuthApiBase(apiBase?: string): string {
  return normalizeApiBase(apiBase ?? API_BASE);
}

// Secure token storage via Rust backend
export const getAuthToken = async (): Promise<string | null> => {
  if (authTokenCache !== undefined) {
    return authTokenCache;
  }

  try {
    authTokenCache = await commands.getAuthToken();
    return authTokenCache;
  } catch {
    return null;
  }
};

export const storeAuthToken = async (token: string): Promise<void> => {
  await commands.storeAuthToken(token);
  authTokenCache = token;
};

export const removeAuthToken = async (): Promise<void> => {
  authTokenCache = null;
  await commands.removeAuthToken();
};

const DEFAULT_AUTHENTICATED_FETCH_TIMEOUT_MS = 10_000;

interface AuthenticatedFetchOptions extends RequestInit {
  /**
   * How long the request may take. Defaults to 10 seconds when no `signal` is given; a
   * caller's `signal` and timeout both apply when both are set. `null` disables the timeout.
   */
  timeoutMs?: number | null;
}

function authenticatedFetchSignal(
  signal: AbortSignal | null | undefined,
  timeoutMs: number | null | undefined,
): AbortSignal | undefined {
  const timeout =
    timeoutMs === undefined ? (signal ? null : DEFAULT_AUTHENTICATED_FETCH_TIMEOUT_MS) : timeoutMs;
  if (timeout === null) return signal ?? undefined;
  const timeoutSignal = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

// Authenticated API fetch helper
export async function authenticatedFetch(
  path: string,
  options: AuthenticatedFetchOptions = {},
  tokenOverride?: string,
): Promise<Response> {
  const token = tokenOverride ?? (await getAuthToken());
  if (!token) {
    throw new Error("Not authenticated");
  }

  const { timeoutMs, signal, ...requestOptions } = options;
  return tauriFetch(`${getPreferredAuthApiBase()}${path}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    signal: authenticatedFetchSignal(signal, timeoutMs),
  });
}

export async function fetchCurrentUser(tokenOverride?: string): Promise<AuthUser> {
  const response = await authenticatedFetch("/api/auth/me", {}, tokenOverride);
  if (!response.ok) {
    throw await authApiError(`Failed to fetch user: ${response.status}`, response);
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
    throw await authApiError(`Failed to fetch subscription: ${response.status}`, response);
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

export async function logoutFromServer(): Promise<void> {
  const apiBase = getPreferredAuthApiBase();
  try {
    const token = await getAuthToken();
    if (!token) return;
    await tauriFetch(`${apiBase}/api/auth/logout`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
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
  const apiBase = getPreferredAuthApiBase(options.apiBase);
  let response: Response;
  try {
    response = await tauriFetch(`${apiBase}/api/auth/desktop/session/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
  } catch {
    options.signal?.throwIfAborted();
    throw new DesktopAuthError("failed", getApiBaseUnavailableMessage(apiBase));
  }
  if (response.status === 404) {
    throw new DesktopAuthError(
      "endpoint_unavailable",
      "Desktop sign-in is unavailable on this server.",
    );
  }
  if (!response.ok) {
    throw new DesktopAuthError("failed", `Desktop sign-in failed (${response.status}).`);
  }
  const parsed = parseDesktopAuthInitResponse(await response.json());
  if (!parsed) throw new DesktopAuthError("failed", "Invalid desktop sign-in response.");
  return { ...parsed, apiBase };
}

function parseDesktopAuthInitResponse(payload: unknown): DesktopAuthInitResponse | null {
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

  let interval = DESKTOP_AUTH_POLL_INTERVAL_MS;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    const url = `${apiBase}/api/auth/desktop/session?session=${encodeURIComponent(sessionId)}`;
    let response: Response;
    try {
      response = await tauriFetch(url, {
        method: "GET",
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
        headers: {
          [DESKTOP_SESSION_SECRET_HEADER]: pollSecret,
        },
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      throw new DesktopAuthError(
        "failed",
        error instanceof Error
          ? `${getApiBaseUnavailableMessage(apiBase)} ${error.message}`
          : getApiBaseUnavailableMessage(apiBase),
      );
    }

    if (response.status === 410) {
      throw new DesktopAuthError("expired", "Desktop sign-in session expired.");
    }

    // Read the body before judging the status: a server answers an unknown session with
    // `{ status: "missing" }` (200 now, 404 on older servers), which is not a missing endpoint.
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const parsed = parseDesktopAuthPollResponse(payload);

    if (response.status === 404 && !parsed) {
      throw new DesktopAuthError(
        "endpoint_unavailable",
        "Desktop auth session endpoint is unavailable on this server.",
      );
    }

    if (!response.ok && response.status !== 404) {
      throw new DesktopAuthError("failed", `Desktop sign-in failed (${response.status}).`);
    }

    if (!parsed) {
      throw new DesktopAuthError("failed", "Invalid desktop sign-in response.");
    }

    if (parsed.status === "ready") {
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

    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())), options.signal);
    interval = Math.min(interval * 1.5, 5000);
  }

  throw new DesktopAuthError("timeout", "Desktop sign-in timed out. Please try again.");
}

export const __test__ = {
  parseDesktopAuthInitResponse,
  parseDesktopAuthPollResponse,
  parseSubscriptionInfoResponse,
  getApiBaseUnavailableMessage,
  getPreferredAuthApiBase,
};
