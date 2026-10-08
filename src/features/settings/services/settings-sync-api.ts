import { AuthApiError, authenticatedFetch } from "@/features/auth/services/auth-api";

export interface CloudSettingsSyncSnapshot {
  schemaVersion: number;
  updatedAt: string;
  settings: Record<string, unknown>;
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
