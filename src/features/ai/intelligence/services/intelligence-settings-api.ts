import { tauriFetch } from "@/utils/tauri-fetch";
import { getAuthToken } from "@/features/auth/services/auth-api";
import { useAuthStore } from "@/features/auth/stores/auth.store";
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
  if (!token) throw new IntelligenceSettingsError("Sign in to sync your AI settings.", 401);
  const response = await tauriFetch(
    `${getApiBase()}/api/account/intelligence?scope=${encodeURIComponent(scope)}`,
    {
      method: update ? "PUT" : "GET",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(update ? { body: JSON.stringify({ scope, ...update }) } : {}),
    },
  );
  // A proxy or outage page is HTML, so a body that is not JSON must not hide the status.
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new IntelligenceSettingsError(
      (typeof data?.error === "string" && data.error) || "Could not sync your AI settings.",
      response.status,
    );
  if (
    !data ||
    data.scope !== scope ||
    !Array.isArray(data.scopes) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0
  ) {
    throw new IntelligenceSettingsError("Athas returned invalid AI settings.", 502);
  }
  return { ...data, preferences: parseIntelligencePreferences(data.preferences) };
}
