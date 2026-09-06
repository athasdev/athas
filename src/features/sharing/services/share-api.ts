import { authenticatedFetch } from "@/features/window/services/auth-api";
import type { ShareInput, ShareOptions } from "../types/share.types";

export async function shareRequest<T>(
  path: string,
  options?: RequestInit,
  token?: string,
): Promise<T> {
  const response = await authenticatedFetch(path, options, token);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not reach Athas sharing. Try again.");
  return body as T;
}

export function fetchShareOptions(token?: string) {
  return shareRequest<ShareOptions>("/api/shares", undefined, token);
}

export function createShare(input: ShareInput) {
  return shareRequest<{ id: string; url: string }>("/api/shares", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeShare(id: string) {
  return shareRequest<{ revoked: boolean }>(`/api/shares/${id}`, { method: "DELETE" });
}

export function updateShare(
  id: string,
  revision: number,
  changes: Record<string, unknown>,
  token?: string,
) {
  return shareRequest<{ revision: number }>(
    `/api/shares/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ ...changes, revision }),
    },
    token,
  );
}

export function setSessionSync(enabled: boolean) {
  return shareRequest<{ sessionsEnabled: boolean }>("/api/cloud-sessions", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}
