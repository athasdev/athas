import { authenticatedFetch } from "@/features/window/services/auth-api";
import type { ShareInput, ShareOptions } from "../types/share.types";

async function shareRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not reach Athas sharing. Try again.");
  return body as T;
}

export function fetchShareOptions() {
  return shareRequest<ShareOptions>("/api/shares");
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
