import type { AcpAuthRequest } from "@/features/ai/stores/acp-auth.store";
import type { AcpQuestion } from "@/features/ai/stores/acp-questions.store";

/** What a chat is blocked on until the user acts. */
export type ChatAttention = "permission" | "question" | "auth";

export interface ChatAttentionInput {
  chatId: string;
  /** The chat's ACP session, when it has one. */
  sessionId: string | null | undefined;
  pendingPermissions: number;
  questions: readonly AcpQuestion[];
  authRequest: AcpAuthRequest | null;
}
