import type { IntelligenceAgentErrorDetails } from "../types/intelligence-agent.types";

/**
 * A failed model request. It carries `statusCode` and a JSON `responseBody` the way an SDK
 * `APICallError` does, so the chat's error formatting maps it to the same actions.
 */
export class IntelligenceAgentError extends Error implements IntelligenceAgentErrorDetails {
  readonly code?: string;
  readonly statusCode?: number;
  readonly responseBody?: string;

  constructor(message: string, details: IntelligenceAgentErrorDetails = {}) {
    super(message);
    this.name = "IntelligenceAgentError";
    this.code = details.code;
    this.statusCode = details.statusCode;
    if (details.statusCode !== undefined)
      this.responseBody = JSON.stringify({ error: { message, code: details.code } });
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  allowance_exhausted: 402,
  insufficient_balance: 402,
  spending_limit_reached: 402,
  request_too_large: 413,
  timeout: 504,
};

function statusFromCode(code: string | undefined) {
  if (!code) return undefined;
  const http = /^http_(\d{3})$/.exec(code);
  return http ? Number(http[1]) : STATUS_BY_CODE[code];
}

/**
 * Turns whatever a model stream failed with into an `Error`. Stream error chunks arrive as plain
 * objects such as `{ message, code }`, which would otherwise render as "[object Object]".
 */
export function toIntelligenceAgentError(error: unknown): Error {
  if (error instanceof Error) {
    // The SDK turns error chunks into errors that keep the server's `code` but no status; give
    // them the status the code stands for so the chat can offer the matching action.
    const { code, statusCode } = error as Error & { code?: unknown; statusCode?: unknown };
    if (typeof statusCode === "number" || typeof code !== "string") return error;
    const mapped = statusFromCode(code);
    if (mapped === undefined) return error;
    return new IntelligenceAgentError(error.message, { code, statusCode: mapped });
  }
  if (typeof error === "string") return new IntelligenceAgentError(error);
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const nested =
      value.error && typeof value.error === "object"
        ? (value.error as Record<string, unknown>)
        : value;
    const message =
      typeof nested.message === "string" && nested.message.trim()
        ? nested.message
        : "The model request failed.";
    const code =
      typeof nested.code === "string" || typeof nested.code === "number"
        ? String(nested.code)
        : undefined;
    // Athas's hosted stream puts the upstream status in `param`; the SDK keeps only the
    // OpenAI-style fields (message, type, param, code) of an error chunk.
    const param =
      nested.param && typeof nested.param === "object"
        ? (nested.param as Record<string, unknown>)
        : {};
    const statusCode =
      typeof nested.statusCode === "number"
        ? nested.statusCode
        : typeof param.statusCode === "number"
          ? param.statusCode
          : statusFromCode(code);
    return new IntelligenceAgentError(message, { code, statusCode });
  }
  return new IntelligenceAgentError("The model request failed.");
}
