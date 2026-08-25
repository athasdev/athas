import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/features/window/services/auth-api";
import { getApiBase } from "@/utils/api-base";
import {
  parseUIExtensionGenerationResult,
  type UIExtensionContributionType,
  type UIExtensionGenerationResult,
} from "./ui-extension-generation-result";

export type {
  UIExtensionContributionType,
  UIExtensionGenerationResult,
} from "./ui-extension-generation-result";

const API_BASE = getApiBase();

class UIExtensionGenerationError extends Error {
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
    throw new UIExtensionGenerationError("Sign in to use Athas Intelligence.", 401);
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
      message = "Sign in to use Athas Intelligence.";
    } else if (response.status === 402 || response.status === 403) {
      message = "Athas Intelligence is included with Athas Pro.";
    }

    throw new UIExtensionGenerationError(message, response.status);
  }

  try {
    return parseUIExtensionGenerationResult(body);
  } catch (error) {
    if (error instanceof Error && error.message !== "Invalid UI extension generation response.") {
      throw new UIExtensionGenerationError(error.message, 500);
    }
    throw new UIExtensionGenerationError("Invalid UI extension generation response.", 500);
  }
}
