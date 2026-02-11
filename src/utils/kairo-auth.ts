import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
} from "./token-manager";

const PENDING_AUTH_STORAGE_KEY = "kairo_oauth_pkce";
const TOKEN_PROVIDER_ID = "kairo-code";
const DEFAULT_SCOPE = "kairo.code:stream kairo.models:read";
const DEFAULT_EXPIRY_SECONDS = 60 * 60;
const DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_DEVICE_CODE_EXPIRY_SECONDS = 15 * 60;
const DEFAULT_KAIRO_CLIENT_ID_PROD = "kairo_client_athas_b171f5a87dfa";
const DEFAULT_KAIRO_CLIENT_ID_DEV = "kairo_client_athas_dev_0290ad54d20f";
const DEFAULT_KAIRO_CLIENT_ID = import.meta.env.DEV
  ? DEFAULT_KAIRO_CLIENT_ID_DEV
  : DEFAULT_KAIRO_CLIENT_ID_PROD;
const DEFAULT_KAIRO_REDIRECT_URI = "athas://kairo/callback";
const KAIRO_DEFAULT_MODEL_ID = "gpt-5.2";
const KAIRO_FALLBACK_MODELS: KairoModelOption[] = [
  { id: "gpt-5.2", name: "GPT-5.2" },
  { id: "gpt-5.1", name: "GPT-5.1" },
  { id: "gpt-5", name: "GPT-5" },
  { id: "gpt-5-mini", name: "GPT-5 Mini" },
  { id: "gpt-5-nano", name: "GPT-5 Nano" },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
];

export const KAIRO_BASE_URL = import.meta.env.VITE_KAIRO_BASE_URL || "https://coline.app";
export const KAIRO_CLIENT_ID = import.meta.env.VITE_KAIRO_CLIENT_ID || DEFAULT_KAIRO_CLIENT_ID;
export const KAIRO_REDIRECT_URI =
  import.meta.env.VITE_KAIRO_REDIRECT_URI || DEFAULT_KAIRO_REDIRECT_URI;
export const KAIRO_CLIENT_NAME = import.meta.env.VITE_KAIRO_CLIENT_NAME || "athas";
export const KAIRO_CLIENT_VERSION = import.meta.env.VITE_KAIRO_CLIENT_VERSION || "0.0.0";
export const KAIRO_CLIENT_PLATFORM = import.meta.env.VITE_KAIRO_CLIENT_PLATFORM || "desktop";

export interface KairoModelOption {
  id: string;
  name: string;
}

interface PendingPkceState {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

interface TokenEndpointResponse {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  token_type?: string;
  tokenType?: string;
  scope?: string;
  expires_in?: number;
  expiresIn?: number;
  error?: string;
  error_description?: string;
  errorDescription?: string;
}

interface DeviceAuthorizeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  scope?: string;
  error?: string;
  error_description?: string;
  errorDescription?: string;
}

interface KairoModelsResponse {
  models?: unknown;
  defaultModel?: unknown;
  default_model?: unknown;
  data?: {
    models?: unknown;
    defaultModel?: unknown;
    default_model?: unknown;
  };
}

interface StoredKairoTokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  expiresAt: number;
}

const base64UrlEncode = (bytes: Uint8Array): string => {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const randomString = (length = 48): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).slice(0, length);
};

const toCodeChallenge = async (verifier: string): Promise<string> => {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64UrlEncode(new Uint8Array(digest));
};

const readPendingPkce = (): PendingPkceState | null => {
  try {
    const raw = localStorage.getItem(PENDING_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPkceState;
    if (!parsed.state || !parsed.codeVerifier) return null;
    return parsed;
  } catch {
    return null;
  }
};

const savePendingPkce = (pending: PendingPkceState): void => {
  localStorage.setItem(PENDING_AUTH_STORAGE_KEY, JSON.stringify(pending));
};

const clearPendingPkce = (): void => {
  localStorage.removeItem(PENDING_AUTH_STORAGE_KEY);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const getOauthErrorCode = (error: unknown): string | null => {
  if (!(error instanceof Error)) return null;
  const [code] = error.message.split(":", 1);
  const normalized = code?.trim();
  return normalized ? normalized : null;
};

const parseStoredTokens = (raw: string | null): StoredKairoTokenSet | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredKairoTokenSet;
    if (!parsed.accessToken || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const normalizeTokenResponse = (data: TokenEndpointResponse): StoredKairoTokenSet => {
  const accessToken = data.access_token || data.accessToken;
  if (!accessToken) {
    throw new Error("Missing access token in OAuth response");
  }

  const refreshToken = data.refresh_token || data.refreshToken;
  const tokenType = data.token_type || data.tokenType || "Bearer";
  const expiresIn = data.expires_in || data.expiresIn || DEFAULT_EXPIRY_SECONDS;
  const scope = data.scope;

  return {
    accessToken,
    refreshToken,
    tokenType,
    scope,
    expiresAt: Date.now() + expiresIn * 1000,
  };
};

const exchangeToken = async (payload: Record<string, unknown>): Promise<StoredKairoTokenSet> => {
  const response = await tauriFetch(`${KAIRO_BASE_URL}/api/kairo/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const rawBody = await response.text();
  let body: TokenEndpointResponse = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as TokenEndpointResponse) : {};
  } catch {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${rawBody || "OAuth token exchange failed"}`);
    }
    throw new Error("Invalid OAuth response payload");
  }

  if (!response.ok) {
    const code = body.error || `HTTP ${response.status}`;
    const message =
      body.error_description || body.errorDescription || "OAuth token exchange failed";
    throw new Error(`${code}: ${message}`);
  }

  if (body.error) {
    const message =
      body.error_description || body.errorDescription || "OAuth token exchange failed";
    throw new Error(`${body.error}: ${message}`);
  }

  return normalizeTokenResponse(body);
};

const normalizeKairoModel = (model: unknown): KairoModelOption | null => {
  if (typeof model === "string") {
    const id = model.trim();
    if (!id) return null;
    return { id, name: id };
  }

  if (!model || typeof model !== "object") {
    return null;
  }

  const candidate = model as Record<string, unknown>;
  const rawId = candidate.id ?? candidate.modelType ?? candidate.model_type ?? candidate.name;
  if (typeof rawId !== "string" || !rawId.trim()) {
    return null;
  }

  const id = rawId.trim();
  const rawName =
    candidate.displayName ?? candidate.display_name ?? candidate.label ?? candidate.name ?? id;
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : id;

  return { id, name };
};

const getNormalizedKairoModels = (models: unknown): KairoModelOption[] => {
  if (!Array.isArray(models)) {
    return [];
  }

  const deduped = new Map<string, KairoModelOption>();
  for (const model of models) {
    const normalized = normalizeKairoModel(model);
    if (!normalized) continue;
    deduped.set(normalized.id, normalized);
  }
  return Array.from(deduped.values());
};

const getDefaultKairoModelId = (
  models: KairoModelOption[],
  defaultModelCandidate?: unknown,
): string => {
  const explicitDefault =
    typeof defaultModelCandidate === "string" && defaultModelCandidate.trim()
      ? defaultModelCandidate.trim()
      : null;

  if (explicitDefault && models.some((model) => model.id === explicitDefault)) {
    return explicitDefault;
  }

  const preferredFallback = models.find((model) => model.id === KAIRO_DEFAULT_MODEL_ID);
  return preferredFallback?.id || models[0]?.id || KAIRO_DEFAULT_MODEL_ID;
};

export async function listKairoModels(): Promise<{
  models: KairoModelOption[];
  defaultModel: string;
}> {
  try {
    const response = await tauriFetch(`${KAIRO_BASE_URL}/api/kairo/models`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const rawBody = await response.text();
    let body: KairoModelsResponse = {};
    try {
      body = rawBody ? (JSON.parse(rawBody) as KairoModelsResponse) : {};
    } catch {
      body = {};
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const models = getNormalizedKairoModels(body.models ?? body.data?.models);
    const resolvedModels = models.length > 0 ? models : KAIRO_FALLBACK_MODELS;
    const defaultModel = getDefaultKairoModelId(
      resolvedModels,
      body.defaultModel ??
        body.default_model ??
        body.data?.defaultModel ??
        body.data?.default_model,
    );

    return {
      models: resolvedModels,
      defaultModel,
    };
  } catch {
    return {
      models: KAIRO_FALLBACK_MODELS,
      defaultModel: getDefaultKairoModelId(KAIRO_FALLBACK_MODELS),
    };
  }
}

const requestDeviceAuthorization = async (): Promise<Required<DeviceAuthorizeResponse>> => {
  const response = await tauriFetch(`${KAIRO_BASE_URL}/api/kairo/oauth/device/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: KAIRO_CLIENT_ID,
      scope: DEFAULT_SCOPE,
    }),
  });

  const rawBody = await response.text();
  let body: DeviceAuthorizeResponse = {};
  try {
    body = rawBody ? (JSON.parse(rawBody) as DeviceAuthorizeResponse) : {};
  } catch {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${rawBody || "OAuth device authorization failed"}`);
    }
    throw new Error("Invalid device authorization response payload");
  }

  if (!response.ok || body.error) {
    const code = body.error || `HTTP ${response.status}`;
    const message =
      body.error_description || body.errorDescription || "OAuth device authorization failed";
    throw new Error(`${code}: ${message}`);
  }

  if (!body.device_code || !body.verification_uri) {
    throw new Error("Invalid device authorization response payload");
  }

  return {
    device_code: body.device_code,
    user_code: body.user_code || "",
    verification_uri: body.verification_uri,
    verification_uri_complete:
      body.verification_uri_complete ||
      `${body.verification_uri}?user_code=${encodeURIComponent(body.user_code || "")}`,
    expires_in: body.expires_in || DEFAULT_DEVICE_CODE_EXPIRY_SECONDS,
    interval: body.interval || DEFAULT_DEVICE_POLL_INTERVAL_SECONDS,
    scope: body.scope || DEFAULT_SCOPE,
    error: "",
    error_description: "",
    errorDescription: "",
  };
};

const pollDeviceAuthorization = async (
  device: Required<DeviceAuthorizeResponse>,
): Promise<StoredKairoTokenSet> => {
  const expiresAt = Date.now() + device.expires_in * 1000;
  let intervalMs = Math.max(1, device.interval) * 1000;

  while (Date.now() < expiresAt) {
    await sleep(intervalMs);

    try {
      return await exchangeToken({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: KAIRO_CLIENT_ID,
        device_code: device.device_code,
      });
    } catch (error) {
      const code = getOauthErrorCode(error);
      if (code === "authorization_pending") {
        continue;
      }
      if (code === "slow_down") {
        intervalMs += 5_000;
        continue;
      }
      if (code === "access_denied") {
        throw new Error("Login was canceled in browser.");
      }
      if (code === "expired_token") {
        throw new Error("Login timed out. Start login again.");
      }
      throw error;
    }
  }

  throw new Error("Login timed out. Start login again.");
};

export const isKairoConfigured = (): boolean => !!KAIRO_CLIENT_ID;

export async function startKairoOAuthLogin(): Promise<"pkce" | "device"> {
  if (!isKairoConfigured()) {
    throw new Error("Kairo OAuth client is not configured.");
  }

  if (import.meta.env.DEV) {
    clearPendingPkce();
    const device = await requestDeviceAuthorization();
    await openUrl(device.verification_uri_complete);
    const tokens = await pollDeviceAuthorization(device);
    await storeProviderApiToken(TOKEN_PROVIDER_ID, JSON.stringify(tokens));
    return "device";
  }

  const state = randomString(32);
  const codeVerifier = randomString(64);
  const codeChallenge = await toCodeChallenge(codeVerifier);
  savePendingPkce({ state, codeVerifier, createdAt: Date.now() });

  const authorizeUrl = new URL(`${KAIRO_BASE_URL}/api/kairo/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", KAIRO_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", KAIRO_REDIRECT_URI);
  authorizeUrl.searchParams.set("scope", DEFAULT_SCOPE);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  await openUrl(authorizeUrl.toString());
  return "pkce";
}

export async function completeKairoOAuthCallback(searchParams: URLSearchParams): Promise<void> {
  const error = searchParams.get("error");
  if (error) {
    const description =
      searchParams.get("error_description") ||
      searchParams.get("errorDescription") ||
      "OAuth error";
    throw new Error(`${error}: ${description}`);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    throw new Error("Missing authorization code or state in callback");
  }

  const pending = readPendingPkce();
  if (!pending) {
    throw new Error("Missing PKCE state. Start login again.");
  }

  if (pending.state !== state) {
    clearPendingPkce();
    throw new Error("OAuth state mismatch. Start login again.");
  }

  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    client_id: KAIRO_CLIENT_ID,
    redirect_uri: KAIRO_REDIRECT_URI,
    code,
    code_verifier: pending.codeVerifier,
  });

  await storeProviderApiToken(TOKEN_PROVIDER_ID, JSON.stringify(tokens));
  clearPendingPkce();
}

async function getStoredKairoTokens(): Promise<StoredKairoTokenSet | null> {
  const raw = await getProviderApiToken(TOKEN_PROVIDER_ID);
  return parseStoredTokens(raw);
}

async function refreshKairoTokens(refreshToken: string): Promise<StoredKairoTokenSet> {
  return exchangeToken({
    grant_type: "refresh_token",
    client_id: KAIRO_CLIENT_ID,
    refresh_token: refreshToken,
  });
}

export async function hasKairoAccessToken(): Promise<boolean> {
  const tokens = await getStoredKairoTokens();
  return !!tokens?.accessToken;
}

export async function getValidKairoAccessToken(): Promise<string | null> {
  const stored = await getStoredKairoTokens();
  if (!stored?.accessToken) {
    return null;
  }

  if (Date.now() < stored.expiresAt - 30_000) {
    return stored.accessToken;
  }

  if (!stored.refreshToken || !isKairoConfigured()) {
    await clearKairoTokens();
    return null;
  }

  try {
    const refreshed = await refreshKairoTokens(stored.refreshToken);
    await storeProviderApiToken(TOKEN_PROVIDER_ID, JSON.stringify(refreshed));
    return refreshed.accessToken;
  } catch {
    await clearKairoTokens();
    return null;
  }
}

export async function clearKairoTokens(): Promise<void> {
  await removeProviderApiToken(TOKEN_PROVIDER_ID);
  clearPendingPkce();
}
