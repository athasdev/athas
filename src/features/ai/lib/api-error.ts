import type { ChatMessageError } from "@/features/ai/types/chat-error.types";

/** A provider failure as it reached the client: an HTTP status, a server code and a raw body. */
export interface ApiErrorInput {
  status?: number;
  code?: string;
  body?: string;
  message?: string;
}

export interface ParsedApiError extends ApiErrorInput {
  message: string;
}

/** The HTTP status each server error code stands for, so recovery actions can match on either. */
const SERVER_CODE_STATUS: Record<string, number> = {
  allowance_exhausted: 402,
  insufficient_balance: 402,
  payment_required: 402,
  entitlement_required: 402,
  provider_rejected: 502,
  timeout: 408,
  unauthorized: 401,
  forbidden: 403,
};

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  "timeout",
  "offline",
  "network",
  "provider_rejected",
  "RECONNECT",
]);

function statusFromServerCode(code: string | undefined): number | undefined {
  if (!code) return undefined;
  const http = /^http_(\d{3})$/i.exec(code);
  if (http) return Number(http[1]);
  return SERVER_CODE_STATUS[code];
}

function readJson(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The server's error code and message from a JSON body such as `{ error: { code, message } }`. */
export function readErrorBody(body: string | undefined): { code?: string; message?: string } {
  const json = readJson(body);
  if (!json) return {};
  const nested =
    json.error && typeof json.error === "object" ? (json.error as Record<string, unknown>) : null;
  const code = [nested?.code, json.code, nested?.type].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const message = [nested?.message, json.error, json.message].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return { code, message };
}

function statusFromText(text: string): number | undefined {
  const match =
    text.match(/\bHTTP\s*(\d{3})\b/i)?.[1] ??
    text.match(/(?:error|status)(?: code)?:?\s*(\d{3})\b/i)?.[1];
  if (match) return Number(match);
  if (/payment required/i.test(text)) return 402;
  if (/unauthorized/i.test(text)) return 401;
  if (/forbidden/i.test(text)) return 403;
  return undefined;
}

function codeFromText(text: string): string | undefined {
  return text.match(/\b(allowance_exhausted|provider_rejected|http_\d{3}|timeout)\b/)?.[1];
}

/**
 * Reads a provider failure into its status, server code and body. Accepts the structured
 * fields directly, an SDK error carrying `statusCode`/`responseBody`, or the legacy
 * `"<provider> API error: 402|||<body>"` string the chat service passes around.
 */
export function parseApiError(input: unknown): ParsedApiError {
  if (typeof input === "string") {
    const [head, ...rest] = input.split("|||");
    const body = rest.length > 0 ? rest.join("|||") : undefined;
    const fromBody = readErrorBody(body);
    const code = fromBody.code ?? codeFromText(input);
    return {
      status: statusFromText(head) ?? statusFromServerCode(code),
      code,
      body,
      message: fromBody.message ?? head,
    };
  }
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const status =
      typeof record.status === "number"
        ? record.status
        : typeof record.statusCode === "number"
          ? record.statusCode
          : undefined;
    const body =
      typeof record.body === "string"
        ? record.body
        : typeof record.responseBody === "string"
          ? record.responseBody
          : undefined;
    const fromBody = readErrorBody(body);
    const ownMessage = typeof record.message === "string" ? record.message : "";
    const code =
      (typeof record.code === "string" ? record.code : undefined) ??
      fromBody.code ??
      codeFromText(ownMessage);
    return {
      status: status ?? statusFromText(ownMessage) ?? statusFromServerCode(code),
      code,
      body,
      message: fromBody.message ?? (ownMessage || "Request failed"),
    };
  }
  return { message: String(input) };
}

/** The HTTP status a failure maps to, as a string, or `""` when nothing identifies it. */
export function getApiErrorCode(input: string | ApiErrorInput): string {
  const status = parseApiError(input).status;
  return status ? String(status) : "";
}

export function isRetryableApiError(error: Pick<ChatMessageError, "code" | "status">): boolean {
  if (error.code && RETRYABLE_CODES.has(error.code)) return true;
  return error.status !== undefined && RETRYABLE_STATUSES.has(error.status);
}

/** A structured message error from any provider failure, optionally with a friendlier message. */
export function toChatMessageError(input: unknown, message?: string): ChatMessageError {
  const parsed = parseApiError(input);
  const error: ChatMessageError = { message: message ?? parsed.message };
  if (parsed.code) error.code = parsed.code;
  if (parsed.status) error.status = parsed.status;
  error.retryable = isRetryableApiError(error);
  return error;
}

/**
 * The string form the chat service reports failures in. A status and server code on the error
 * survive into it, so `parseApiError` can read them back.
 */
export function formatApiError(providerId: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const status =
    typeof record.statusCode === "number"
      ? record.statusCode
      : typeof record.status === "number"
        ? record.status
        : undefined;
  const code = typeof record.code === "string" && record.code ? record.code : undefined;
  const body =
    typeof record.responseBody === "string"
      ? record.responseBody
      : code
        ? JSON.stringify({ error: { code, message } })
        : message;
  if (status !== undefined) return `${providerId} API error: ${status}|||${body}`;
  if (code) return `${providerId} API error: ${code}|||${body}`;
  return `Failed to connect to ${providerId} API: ${message}`;
}
