import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { resolveAgentSessionIconId } from "@/features/ai/lib/agent-session-icon";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Chat } from "@/features/ai/types/ai-chat.types";

interface AgentSessionIconProps {
  /** Looks the session up in the store. Use when only the id is at hand. */
  sessionId?: string | null;
  /** Already-resolved session, to avoid a redundant lookup. */
  session?: Pick<Chat, "agentId" | "providerId"> | null;
  fallbackProviderId?: string | null;
  size?: number;
  className?: string;
}

/** The one agent-session mark, shared by the tab bar, sidebar and history. */
export function AgentSessionIcon({
  sessionId,
  session,
  fallbackProviderId,
  size = 14,
  className,
}: AgentSessionIconProps) {
  const storedSession = useAIChatStore((state) =>
    sessionId && !session ? state.chats.find((chat) => chat.id === sessionId) : undefined,
  );

  return (
    <ProviderIcon
      providerId={resolveAgentSessionIconId(session ?? storedSession, fallbackProviderId)}
      size={size}
      className={className}
    />
  );
}
