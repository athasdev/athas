import { getChatAttentionLabel } from "@/features/ai/lib/chat-attention";
import type { ChatAttention } from "@/features/ai/types/chat-attention.types";

/** Marks a chat that is waiting on the user: a permission prompt, a question, or a sign-in. */
export function AgentAttentionDot({ attention }: { attention: ChatAttention }) {
  const label = getChatAttentionLabel(attention);
  return (
    <div
      className="size-2 shrink-0 rounded-full bg-warning"
      title={label}
      role="img"
      aria-label={label}
    />
  );
}
