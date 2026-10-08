import {
  isAcpAuthenticationError,
  isAcpConfigurationError,
} from "@/features/ai/lib/acp-authentication";
import {
  isRequestTooLarge,
  isRetryableApiError,
  parseApiError,
  readErrorBody,
} from "@/features/ai/lib/api-error";
import { formatUsdCents } from "@/features/ai/services/hosted-usage";
import type { ChatMessageError } from "@/features/ai/types/chat-error.types";

/** How a failed agent turn is shown: a legacy error block for the transcript plus its structure. */
interface AgentTurnFailure {
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

function isNetworkErrorMessage(message: string): boolean {
  return NETWORK_ERROR_PATTERN.test(message);
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** A headline and next step for a hosted request the server refused over billing. */
function describeHostedBillingFailure(
  code: string | undefined,
  walletBalanceCents: number | undefined,
): { title: string; message: string } | null {
  switch (code) {
    case "allowance_exhausted":
      return {
        title: "Included credit used up",
        message:
          walletBalanceCents && walletBalanceCents > 0
            ? `Your included Athas credit is used up and your pay-as-you-go balance (${formatUsdCents(walletBalanceCents)}) doesn't cover this request. Add credit to continue, or choose another model.`
            : "Your included Athas credit for this month is used up. Add pay-as-you-go credit to keep going, or choose another model.",
      };
    case "insufficient_balance":
      return {
        title: "Not enough credit",
        message:
          "Your pay-as-you-go balance doesn't cover this request. Add credit to continue, or choose another model.",
      };
    case "spending_limit_reached":
      return {
        title: "Spending limit reached",
        message:
          "You've reached the monthly spending limit set for Athas AI. Raise it in billing to continue, or choose another model.",
      };
    case "entitlement_required":
      return {
        title: "Pro or credit required",
        message:
          "Athas models need Pro or pay-as-you-go credit. Upgrade or add credit in billing to use them.",
      };
    default:
      return null;
  }
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
  let explainedBilling = false;

  if (status === 429) {
    title = "Rate Limit Exceeded";
    message = "The API is temporarily rate-limited. Please wait a moment and try again.";
  } else if (status === 401) {
    title = "Authentication Error";
    message =
      providerId === "athas"
        ? "Your Athas session has expired. Sign in to continue."
        : "The provider rejected your API key. Check its configuration to continue.";
  } else if (isRequestTooLarge({ code: serverCode, status })) {
    title = "Conversation too large";
    message =
      "This conversation is too large for one request. Start a new chat, or remove attached files and long pasted text.";
  } else if (status === 402) {
    const billing =
      providerId === "athas"
        ? describeHostedBillingFailure(serverCode, parsed.walletBalanceCents)
        : null;
    explainedBilling = billing !== null;
    title = billing?.title ?? "Payment required";
    message =
      billing?.message ??
      "Check your balance and spending limits to continue, or choose another model.";
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
  const ownMessage =
    status === 401 || isRequestTooLarge({ code: serverCode, status }) || explainedBilling;
  if (detailMessage && !ownMessage) {
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

  const error: ChatMessageError = { title, message, details: details || mainError, providerId };
  if (code) error.code = code;
  if (status) error.status = status;
  if (parsed.billingUrl && status === 402) error.billingUrl = parsed.billingUrl;
  error.retryable = isRetryableApiError(error);
  if (acpConfig || acpAuth) error.actions = ["restart_agent", "open_agent_terminal"];

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
