import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { AgentAttentionDot } from "./agent-attention-dot";
import { AgentSessionIcon } from "./icons/agent-session-icon";
import { useChatAttention } from "../hooks/use-chat-attention";

type AgentBuffer = Extract<PaneContent, { type: "agent" }>;

/** The tab icon of an agent chat: the mark of its agent. */
export function AgentTabIcon({ buffer }: { buffer: AgentBuffer }) {
  return (
    <AgentSessionIcon sessionId={buffer.sessionId} size={12} className="text-subtle-foreground" />
  );
}

/** Marks an agent chat tab whose chat is waiting on the user. */
export function AgentTabAttention({ buffer }: { buffer: AgentBuffer }) {
  const attention = useChatAttention(buffer.sessionId);
  return attention ? <AgentAttentionDot attention={attention} /> : null;
}
