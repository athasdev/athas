export interface StreamErrorInfo {
  title: string;
  message: string;
  code: string;
  details: string;
  retryable: boolean;
}

const RETRYABLE_ERROR_CODES = new Set(["408", "409", "425", "429", "500", "502", "503", "504"]);

const RETRYABLE_ERROR_PATTERNS = [
  /connection lost/i,
  /disconnected unexpectedly/i,
  /timed out/i,
  /timeout/i,
  /network/i,
  /temporarily unavailable/i,
  /temporarily rate-limited/i,
  /rate.?limit/i,
  /overloaded/i,
  /try again later/i,
];

export const getStreamRetryDelayMs = (attempt: number): number =>
  Math.min(1000 * 2 ** Math.max(attempt - 1, 0), 4000);

export const getStreamErrorInfo = (
  error: string,
  canReconnect: boolean = false,
): StreamErrorInfo => {
  let title = "API Error";
  let message = error;
  let code = "";
  let details = error;

  const parts = error.split("|||");
  const mainError = parts[0] ?? error;
  if (parts.length > 1) {
    details = parts[1] ?? error;
  }

  const codeMatch = mainError.match(/error:\s*(\d+)/i);
  if (codeMatch) {
    code = codeMatch[1] ?? "";
    if (code === "429") {
      title = "Rate Limit Exceeded";
      message = "The API is temporarily rate-limited. Please wait a moment and try again.";
    } else if (code === "401") {
      title = "Authentication Error";
      message = "Invalid API key. Please check your API settings.";
    } else if (code === "403") {
      title = "Access Denied";
      message = "You don't have permission to access this resource.";
    } else if (["500", "502", "503", "504"].includes(code)) {
      title = "Server Error";
      message = "The API server encountered an error. Please try again later.";
    } else if (code === "400") {
      title = "Bad Request";
      if (parts.length > 1) {
        try {
          const parsed = JSON.parse(details);
          if (parsed.error?.message) {
            message = parsed.error.message;
          } else {
            message = mainError;
          }
        } catch {
          message = mainError;
        }
      }
    }
  } else if (/Failed to connect/i.test(mainError)) {
    title = "Connection Error";
    message = mainError;
  }

  if (canReconnect) {
    title = "Connection Lost";
    code = "RECONNECT";
    message = mainError;
  }

  const retryable =
    canReconnect ||
    RETRYABLE_ERROR_CODES.has(code) ||
    RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(mainError));

  return {
    title,
    message,
    code,
    details: details || mainError,
    retryable,
  };
};

export const shouldAutoRetryStreamError = ({
  error,
  attempt,
  maxAttempts,
  hasToolCalls,
  pendingPermissionCount,
}: {
  error: StreamErrorInfo;
  attempt: number;
  maxAttempts: number;
  hasToolCalls: boolean;
  pendingPermissionCount: number;
}): boolean => {
  if (!error.retryable) return false;
  if (attempt > maxAttempts) return false;
  if (hasToolCalls) return false;
  if (pendingPermissionCount > 0) return false;
  return true;
};

export const formatStreamErrorBlock = (error: StreamErrorInfo): string => `[ERROR_BLOCK]
title: ${error.title}
code: ${error.code}
message: ${error.message}
details: ${error.details}
[/ERROR_BLOCK]`;
