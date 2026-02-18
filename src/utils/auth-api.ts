import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const API_BASE = import.meta.env.VITE_API_URL || "https://athas.dev";
const DESKTOP_AUTH_POLL_INTERVAL_MS = 1500;
const DESKTOP_AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DESKTOP_SESSION_SECRET_HEADER = "X-Desktop-Session-Secret";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  avatar_url: string | null;
  provider: string | null;
  github_username: string | null;
  subscription_status: "free" | "trial" | "pro";
  created_at: string;
}

export interface SubscriptionInfo {
  status: "free" | "trial" | "pro";
  subscription: {
    plan: string;
    renews_at: string | null;
    ends_at: string | null;
    trial_ends_at: string | null;
  } | null;
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

export class DesktopAuthError extends Error {
  code: "endpoint_unavailable" | "expired" | "timeout" | "failed";

  constructor(code: DesktopAuthError["code"], message: string) {
    super(message);
    this.name = "DesktopAuthError";
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Secure token storage via Rust backend
export const getAuthToken = async (): Promise<string | null> => {
  try {
    return await invoke<string | null>("get_auth_token");
  } catch {
    return null;
  }
};

export const storeAuthToken = async (token: string): Promise<void> => {
  await invoke("store_auth_token", { token });
};

export const removeAuthToken = async (): Promise<void> => {
  await invoke("remove_auth_token");
};

// Authenticated API fetch helper
async function authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("Not authenticated");
  }

  return tauriFetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const response = await authenticatedFetch("/api/auth/me");
  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.status}`);
  }
  const data = await response.json();
  return data.user;
}

export async function fetchSubscriptionStatus(): Promise<SubscriptionInfo> {
  const response = await authenticatedFetch("/api/auth/subscription");
  if (!response.ok) {
    throw new Error(`Failed to fetch subscription: ${response.status}`);
  }
  return await response.json();
}

export async function logoutFromServer(): Promise<void> {
  try {
    await authenticatedFetch("/api/auth/logout", { method: "DELETE" });
  } catch {
    // Even if server logout fails, we still clear the local token
  }
}

export async function beginDesktopAuthSession(): Promise<{
  sessionId: string;
  pollSecret: string;
  loginUrl: string;
}> {
  const response = await tauriFetch(`${API_BASE}/api/auth/desktop/session/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (response.status === 404) {
    throw new DesktopAuthError(
      "endpoint_unavailable",
      "Desktop auth session endpoint is unavailable on this server.",
    );
  }

  if (!response.ok) {
    throw new DesktopAuthError(
      "failed",
      `Failed to initialize desktop sign-in (${response.status}).`,
    );
  }

  const payload = (await response.json()) as DesktopAuthInitResponse;
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
  const pollSecret = typeof payload.pollSecret === "string" ? payload.pollSecret : "";
  const loginUrl = typeof payload.loginUrl === "string" ? payload.loginUrl : "";

  if (!sessionId || !pollSecret || !loginUrl) {
    throw new DesktopAuthError("failed", "Invalid desktop sign-in initialization response.");
  }

  return { sessionId, pollSecret, loginUrl };
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
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const url = `${API_BASE}/api/auth/desktop/session?session=${encodeURIComponent(sessionId)}`;
    const response = await tauriFetch(url, {
      method: "GET",
      headers: {
        [DESKTOP_SESSION_SECRET_HEADER]: pollSecret,
      },
    });

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
