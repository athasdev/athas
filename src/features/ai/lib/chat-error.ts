import type { ChatErrorAction, ChatMessageError } from "@/features/ai/types/chat-error.types";
import { getApiErrorCode } from "./api-error";

const AGENT_SETUP_CODES = new Set(["auth_required", "config_required"]);
const ERROR_BLOCK_PATTERN = /\[ERROR_BLOCK\][\s\S]*?(?:\[\/ERROR_BLOCK\]|$)/g;

/** Message text without its `[ERROR_BLOCK]` cards, for when the error is rendered or dropped. */
export function stripErrorBlocks(content: string): string {
  return content.replace(ERROR_BLOCK_PATTERN, "").trim();
}

/** Reads the `key: value` lines of a legacy `[ERROR_BLOCK]` saved in older message content. */
export function parseLegacyErrorBlock(data: string): ChatMessageError {
  const lines = data.split("\n");
  const field = (key: string) =>
    lines
      .find((line) => line.startsWith(`${key}:`))
      ?.slice(key.length + 1)
      .trim() || undefined;

  return {
    title: field("title"),
    code: field("code"),
    message: field("message") ?? "",
    details: field("details"),
    providerId: field("provider") ?? (/athas API/i.test(data) ? "athas" : undefined),
  };
}

export function isAgentSetupError(error: ChatMessageError, kind?: "auth" | "config"): boolean {
  const code = error.code?.toLowerCase() ?? "";
  if (kind === "auth") return code === "auth_required";
  if (kind === "config") return code === "config_required";
  return AGENT_SETUP_CODES.has(code);
}

/** The HTTP-style code provider recovery keys off: the status, a numeric code, or the message's. */
export function getChatErrorCode(error: ChatMessageError): string {
  if (error.status) return String(error.status);
  if (error.code && /^\d{3}$/.test(error.code)) return error.code;
  return getApiErrorCode(error.message) || error.code || "";
}

export function getChatErrorActions(error: ChatMessageError): ChatErrorAction[] {
  if (error.actions) return error.actions;
  if (isAgentSetupError(error)) return ["restart_agent", "open_agent_terminal"];
  return error.retryable === false ? ["provider_settings"] : ["provider_settings", "retry"];
}
