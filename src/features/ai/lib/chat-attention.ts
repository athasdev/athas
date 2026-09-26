import type { ChatAttention, ChatAttentionInput } from "@/features/ai/types/chat-attention.types";

/**
 * What a chat is blocked on until the user acts, or null when it is not waiting on them. A URL
 * question the user already opened is waiting on the browser, not on them.
 */
export function getChatAttention(input: ChatAttentionInput): ChatAttention | null {
  if (input.pendingPermissions > 0) return "permission";
  // Requests with no session (startup sign-ins, request-scoped questions) go to the chat that
  // was talking to the agent when they came.
  const isOwn = (request: { sessionId: string | null; chatId?: string | null }) =>
    request.sessionId
      ? request.sessionId === input.sessionId
      : Boolean(request.chatId) && request.chatId === input.chatId;
  if (input.questions.some((question) => isOwn(question) && !question.waiting)) {
    return "question";
  }
  if (input.authRequest && isOwn(input.authRequest) && input.authRequest.phase === "choosing") {
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
