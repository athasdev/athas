import { authenticatedFetch } from "@/features/auth/services/auth-api";
import type { Preview, PreviewConnectTicket } from "../types/previews.types";

export class PreviewsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PreviewsError";
  }
}

async function previewsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/previews${path}`, { ...init, timeoutMs: 15_000 });
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok)
    throw new PreviewsError(
      body.error || "Previews are temporarily unavailable.",
      response.status,
      body.code,
    );
  return body as T;
}

export function createLocalPreview(port: number) {
  return previewsRequest<{ preview: Preview; connect: PreviewConnectTicket }>("", {
    method: "POST",
    body: JSON.stringify({ kind: "local", port }),
  });
}

export async function createSandboxPreview(runId: string, port: number) {
  return (
    await previewsRequest<{ preview: Preview }>("", {
      method: "POST",
      body: JSON.stringify({ kind: "sandbox", runId, port }),
    })
  ).preview;
}

export async function listPreviews() {
  return (await previewsRequest<{ previews: Preview[] }>("")).previews;
}

export async function stopPreview(id: string) {
  return (
    await previewsRequest<{ preview: Preview }>(`/${encodeURIComponent(id)}`, { method: "DELETE" })
  ).preview;
}

export async function refreshPreviewTicket(id: string) {
  return (
    await previewsRequest<{ connect: PreviewConnectTicket }>(`/${encodeURIComponent(id)}/token`, {
      method: "POST",
    })
  ).connect;
}
