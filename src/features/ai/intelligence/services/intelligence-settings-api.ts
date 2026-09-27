import { tauriFetch } from "@/utils/tauri-fetch";
import { getAuthToken } from "@/features/window/services/auth-api";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { getApiBase } from "@/utils/api-base";
import { parseIntelligencePreferences } from "../lib/intelligence-preferences";
import type { IntelligencePreferences, IntelligenceSnapshot } from "../types/intelligence.types";

export class IntelligenceSettingsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchIntelligenceSettings(
  scope: string,
  update?: {
    revision: number;
    preferences: IntelligencePreferences;
  },
  expectedUserId?: number,
): Promise<IntelligenceSnapshot> {
  const token = await getAuthToken();
  if (expectedUserId !== undefined && useAuthStore.getState().user?.id !== expectedUserId) {
    throw new IntelligenceSettingsError("The active account changed. Try again.", 409);
  }
  if (!token) throw new IntelligenceSettingsError("Sign in to sync Intelligence settings.", 401);
  const response = await tauriFetch(
    `${getApiBase()}/api/account/intelligence?scope=${encodeURIComponent(scope)}`,
    {
      method: update ? "PUT" : "GET",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(update ? { body: JSON.stringify({ scope, ...update }) } : {}),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new IntelligenceSettingsError(
      data.error || "Could not sync Intelligence settings.",
      response.status,
    );
  if (
    data.scope !== scope ||
    !Array.isArray(data.scopes) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0
  ) {
    throw new IntelligenceSettingsError("Invalid Intelligence settings response.", 502);
  }
  return { ...data, preferences: parseIntelligencePreferences(data.preferences) };
}
