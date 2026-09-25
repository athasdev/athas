import type { ChatAttention, ChatAttentionInput } from "@/features/ai/types/chat-attention.types";

/**
 * What a chat is blocked on until the user acts, or null when it is not waiting on them. A URL
 * question the user already opened is waiting on the browser, not on them.
 */
export function getChatAttention(input: ChatAttentionInput): ChatAttention | null {
  if (input.pendingPermissions > 0) return "permission";
  if (!input.sessionId) return null;
  if (
    input.questions.some((question) => question.sessionId === input.sessionId && !question.waiting)
  ) {
    return "question";
  }
  if (input.authRequest?.sessionId === input.sessionId && input.authRequest.phase === "choosing") {
    return "auth";
  }
  return null;
}

export function getChatAttentionLabel(attention: ChatAttention): string {
  switch (attention) {
    case "permission":
      return "Waiting for your approval";
    case "question":
      return "Waiting for your answer";
    case "auth":
      return "Waiting for you to sign in";
  }
}
