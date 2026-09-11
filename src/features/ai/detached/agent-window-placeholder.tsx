import { AgentSessionIcon } from "@/features/ai/components/icons/agent-session-icon";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { ArrowCounterClockwiseIcon, WindowExpandIcon } from "@/ui/icons";
import { focusAgentWindow, recallAgentWindow } from "./agent-window-service";
import { useAgentWindowStore } from "./agent-window.store";

/**
 * Stands in for a session that is being edited in its own window. The tab stays
 * put so the session keeps its place, but the content has to say where it went
 * and offer a way back — otherwise it just reads as a broken, empty tab.
 */
export function AgentWindowPlaceholder({ chatId }: { chatId: string }) {
  const status = useAgentWindowStore((state) => state.sessions[chatId]);
  const title = useAIChatStore((state) => state.chats.find((chat) => chat.id === chatId)?.title);
  const isOpening = status === "opening";

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AgentSessionIcon sessionId={chatId} size={20} />
        </EmptyMedia>
        <EmptyTitle>{title || "This session"} is in its own window</EmptyTitle>
        <EmptyDescription>
          {isOpening
            ? "Opening the agent window…"
            : "It keeps running there. Bring it back to continue in this window."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="default"
            disabled={isOpening}
            onClick={() => focusAgentWindow(chatId)}
          >
            <WindowExpandIcon />
            Show window
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={isOpening}
            onClick={() => recallAgentWindow(chatId)}
          >
            <ArrowCounterClockwiseIcon />
            Bring back here
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}
