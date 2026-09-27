import {
  isAcpAuthenticationError,
  isAcpConfigurationError,
} from "@/features/ai/lib/acp-authentication";
import { isRetryableApiError, parseApiError, readErrorBody } from "@/features/ai/lib/api-error";
import type { ChatMessageError } from "@/features/ai/types/chat-error.types";

/** How a failed agent turn is shown: a legacy error block for the transcript plus its structure. */
export interface AgentTurnFailure {
  title: string;
  /** The code the legacy error block carries: an HTTP status or a client code like `OFFLINE`. */
  blockCode: string;
  message: string;
  details: string;
  error: ChatMessageError;
  suppressToast: boolean;
}

const NETWORK_ERROR_PATTERN =
  /error sending request|failed to fetch|networkerror|load failed|dns error|connection refused|connection reset|tcp connect error|network is unreachable|could not reach|no internet/i;

export function isNetworkErrorMessage(message: string): boolean {
  return NETWORK_ERROR_PATTERN.test(message);
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function describeAgentTurnFailure(input: {
  error: string;
  canReconnect?: boolean;
  providerId: string;
  isAcp: boolean;
  offline?: boolean;
}): AgentTurnFailure {
  const { providerId, isAcp } = input;
  const [mainError, ...rest] = input.error.split("|||");
  let details = rest.join("|||");
  const parsed = parseApiError(input.error);
  const serverCode = parsed.code;
  let status = parsed.status;
  let title = "API Error";
  let message = mainError;
  let blockCode = status ? String(status) : "";

  if (status === 429) {
    title = "Rate Limit Exceeded";
    message = "The API is temporarily rate-limited. Please wait a moment and try again.";
  } else if (status === 401) {
    title = "Authentication Error";
    message =
      providerId === "athas"
        ? "Your Athas session has expired. Sign in to continue."
        : "The provider rejected your API key. Check its configuration to continue.";
  } else if (status === 402) {
    title = "Payment required";
    message =
      serverCode === "allowance_exhausted"
        ? "Your included Athas usage for this period is used up. Top up or manage billing to continue."
        : "Check your balance and spending limits to continue, or choose another model.";
  } else if (status === 403) {
    title = "Access Denied";
    message = "You don't have permission to access this resource.";
  } else if (status === 408 || serverCode === "timeout") {
    title = "Request Timed Out";
    message = "The provider took too long to answer. Try again.";
  } else if (status === 500) {
    title = "Server Error";
    message = "The API server encountered an error. Please try again later.";
  } else if (status === 400) {
    title = "Bad Request";
    message = mainError;
  }

  // The server's own explanation is more precise than the generic line for its status.
  const detailMessage = readErrorBody(details).message;
  if (detailMessage && status !== 401 && serverCode !== "allowance_exhausted") {
    message = detailMessage;
  }

  const offline = input.offline ?? isBrowserOffline();
  let code = serverCode;
  if (offline || (!status && isNetworkErrorMessage(mainError))) {
    title = offline ? "Offline" : "Connection Failed";
    blockCode = offline ? "OFFLINE" : "NETWORK";
    code = offline ? "offline" : "network";
    status = undefined;
    message = offline
      ? "You're offline. Reconnect and try again; queued messages wait until then."
      : "Could not reach the provider. Check your connection and try again.";
  }

  const acpConfig = isAcp && isAcpConfigurationError(mainError, details);
  const acpAuth = !acpConfig && isAcp && isAcpAuthenticationError(mainError, details);
  if (acpConfig) {
    title = "Agent Configuration Required";
    blockCode = "CONFIG_REQUIRED";
    code = "config_required";
    message = "The selected agent is authenticated, but its account configuration is incomplete.";
  } else if (acpAuth) {
    title = "Authentication Required";
    blockCode = "AUTH_REQUIRED";
    code = "auth_required";
    message = "The selected agent needs external authentication before it can accept prompts.";
    if (
      mainError.includes("Method not implemented") ||
      details.includes("Method not implemented")
    ) {
      details =
        "This ACP adapter does not implement the protocol authenticate flow. Complete login in the underlying CLI/adapter, then try again.";
    } else if (!details) {
      details = "Complete authentication in the underlying CLI/adapter, then try again.";
    }
  }

  if (input.canReconnect) {
    title = "Connection Lost";
    blockCode = "RECONNECT";
    code = "RECONNECT";
  }

  const error: ChatMessageError = { message };
  if (code) error.code = code;
  if (status) error.status = status;
  error.retryable = isRetryableApiError(error);

  return {
    title,
    blockCode,
    message,
    details: details || mainError,
    error,
    suppressToast:
      offline ||
      (isAcp && (mainError.includes("did not return any response") || blockCode === "RECONNECT")),
  };
}

/** The `[ERROR_BLOCK]` text the transcript renderer and saved chats understand. */
export function formatErrorBlock(fields: {
  title: string;
  code: string;
  provider?: string;
  message: string;
  details: string;
}): string {
  return [
    "[ERROR_BLOCK]",
    `title: ${fields.title}`,
    `code: ${fields.code}`,
    ...(fields.provider !== undefined ? [`provider: ${fields.provider}`] : []),
    `message: ${fields.message}`,
    `details: ${fields.details}`,
    "[/ERROR_BLOCK]",
  ].join("\n");
}
