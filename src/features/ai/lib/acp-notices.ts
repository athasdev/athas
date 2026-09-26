import type { AcpNotice } from "@/features/ai/types/acp.types";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";

/** A notice as a line in the chat's activity timeline. */
export function acpNoticeToChatEvent(notice: AcpNotice): ChatAcpEvent {
  return {
    id: `notice-${notice.id}`,
    category: "notice",
    label: notice.title,
    detail: notice.description ?? undefined,
    state:
      notice.severity === "error" ? "error" : notice.severity === "warning" ? "warning" : "info",
    timestamp: notice.timestamp,
  };
}
