import { hasAgentSessionActivity } from "@/features/ai/services/agent-session-list";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useChatMessageSearchStore } from "@/features/ai/stores/chat-message-search.store";
import type { AgentContent } from "@/features/panes/types/pane-content.types";
import { Button } from "@/ui/button";
import { SearchIcon } from "@/ui/icons";
import { SessionHeaderTools } from "../session-panel/components/session-header-tools";

/**
 * A session's controls at the end of its tab bar, where the session's tab is in front: search its
 * messages once it has some, open its tools in the dock, and its other actions. The tab carries its
 * title, so the session needs no header row of its own.
 */
export function AgentHeaderActions({ buffer }: { buffer: AgentContent; paneId: string }) {
  const chatId = buffer.sessionId;
  const searching = useChatMessageSearchStore((state) => Boolean(state.open[chatId]));
  const { toggle } = useChatMessageSearchStore.use.actions();
  const hasMessages = useAIChatStore((state) => {
    const chat = state.chats.find((candidate) => candidate.id === chatId);
    return (
      (state.messagesByChat[chatId]?.length ?? 0) > 0 ||
      Boolean(chat && hasAgentSessionActivity(chat))
    );
  });
  return (
    <>
      {hasMessages || searching ? (
        <Button
          type="button"
          variant="ghost"
          iconOnly
          size="sm"
          active={searching}
          aria-pressed={searching}
          onClick={() => toggle(chatId)}
          tooltip="Search messages"
          aria-label="Search messages"
        >
          <SearchIcon />
        </Button>
      ) : null}
      <SessionHeaderTools chatId={chatId} />
    </>
  );
}
