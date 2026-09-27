import { tauriFetch } from "@/utils/tauri-fetch";
import { getAuthToken } from "@/features/window/services/auth-api";
import { getApiBase } from "@/utils/api-base";
import { useAuthStore } from "@/features/window/stores/auth.store";
import {
  parseUIExtensionGenerationResult,
  type UIExtensionContributionType,
  type UIExtensionGenerationResult,
} from "./ui-extension-generation-result";

const API_BASE = getApiBase();
const GENERATION_TIMEOUT_MS = 60_000;

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

  let response: Response;
  try {
    response = await tauriFetch(`${API_BASE}/api/ai/ui-extension`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new UIExtensionGenerationError(
        "Generating the integration took too long. Try again with a shorter description.",
        408,
      );
    }
    throw new UIExtensionGenerationError(
      "Could not reach Athas Intelligence. Check your connection and try again.",
      0,
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new UIExtensionGenerationError(
      describeGenerationFailure(response.status, body),
      response.status,
    );
  }

  try {
    return parseUIExtensionGenerationResult(body);
  } catch (error) {
    if (error instanceof Error && error.message !== "Invalid UI integration generation response.") {
      throw new UIExtensionGenerationError(error.message, 500);
    }
    throw new UIExtensionGenerationError("Invalid UI integration generation response.", 500);
  }
}

function describeGenerationFailure(status: number, body: unknown): string {
  const serverMessage =
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : null;
  if (status === 401) return "Sign in to use Athas Intelligence.";
  if (status === 402) {
    // A Pro account that gets 402 has used its included allowance; it is not missing Pro.
    if (useAuthStore.getState().subscription?.status === "pro") {
      return "Your included Athas Intelligence usage is used up for this billing period. Top up or wait for it to reset.";
    }
    return serverMessage ?? "Generating integrations is included with Athas Pro.";
  }
  if (status === 403) {
    return serverMessage ?? "Your organization has turned off this Athas Intelligence feature.";
  }
  return serverMessage ?? `UI integration generation failed (${status})`;
}
