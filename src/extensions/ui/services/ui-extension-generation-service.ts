import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/features/window/services/auth-api";
import { getApiBase } from "@/utils/api-base";

const API_BASE = getApiBase();

export type UIExtensionContributionType = "sidebar" | "toolbar" | "command";

export interface UIExtensionGenerationResult {
  id: string;
  name: string;
  description: string;
  code: string;
}

export class UIExtensionGenerationError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UIExtensionGenerationError";
    this.status = status;
  }
}

export async function requestUIExtensionGeneration(params: {
  contributionType: UIExtensionContributionType;
  description: string;
}): Promise<UIExtensionGenerationResult> {
  const token = await getAuthToken();
  if (!token) {
    throw new UIExtensionGenerationError("Sign in to Athas to use hosted UI generation.", 401);
  }

  const response = await tauriFetch(`${API_BASE}/api/ai/ui-extension`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    let message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `UI extension generation failed (${response.status})`;

    if (response.status === 401) {
      message = "Sign in to Athas to use hosted UI generation.";
    } else if (response.status === 403) {
      message = "Athas Pro is required to generate hosted UI extensions.";
    }

    throw new UIExtensionGenerationError(message, response.status);
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { id?: unknown }).id !== "string" ||
    typeof (body as { name?: unknown }).name !== "string" ||
    typeof (body as { description?: unknown }).description !== "string" ||
    typeof (body as { code?: unknown }).code !== "string"
  ) {
    throw new UIExtensionGenerationError("Invalid UI extension generation response.", 500);
  }

  return body as UIExtensionGenerationResult;
}
