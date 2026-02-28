import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/utils/auth-api";
import { getProviderApiToken } from "@/utils/token-manager";

const API_BASE = import.meta.env.VITE_API_URL || "https://athas.dev";
const OPENROUTER_PROVIDER_ID = "openrouter";
const BYOK_HEADER = "X-OpenRouter-Api-Key";
const DEFAULT_INLINE_EDIT_INSTRUCTION = "Improve this code while preserving behavior.";

export interface InlineEditRequest {
  model: string;
  beforeSelection: string;
  selectedText: string;
  afterSelection?: string;
  instruction?: string;
  filePath?: string;
  languageId?: string;
}

export class InlineEditError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "InlineEditError";
    this.status = status;
  }
}

export async function requestInlineEdit(
  request: InlineEditRequest,
  options?: { useByok?: boolean },
): Promise<{ editedText: string }> {
  const token = await getAuthToken();
  if (!token) {
    throw new InlineEditError("Not authenticated", 401);
  }

  let byokKey: string | null = null;
  if (options?.useByok) {
    byokKey = await getProviderApiToken(OPENROUTER_PROVIDER_ID);
    if (!byokKey) {
      throw new InlineEditError("OpenRouter API key is required for free inline edit.", 402);
    }
  }

  const response = await tauriFetch(`${API_BASE}/api/ai/inline-edit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(byokKey ? { [BYOK_HEADER]: byokKey } : {}),
    },
    body: JSON.stringify({
      ...request,
      afterSelection: request.afterSelection || "",
      instruction: request.instruction?.trim() || DEFAULT_INLINE_EDIT_INSTRUCTION,
    }),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? ((body as { error: string }).error ?? "")
        : `Inline edit request failed (${response.status})`;

    throw new InlineEditError(message, response.status);
  }

  const editedText =
    body &&
    typeof body === "object" &&
    "editedText" in body &&
    typeof (body as { editedText?: unknown }).editedText === "string"
      ? ((body as { editedText: string }).editedText ?? "")
      : "";

  return { editedText };
}
