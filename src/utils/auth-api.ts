import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const API_BASE = import.meta.env.VITE_API_URL || "https://athas.dev";

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

export function getDesktopLoginUrl(): string {
  return `${API_BASE}/auth/desktop`;
}
