import { useEffect } from "react";
import { interruptsAgentFollow } from "@/features/ai/lib/agent-follow";
import { stopFollowingAgent, toggleFollowAgent } from "@/features/ai/services/agent-follow-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useIsFollowingAgent } from "@/features/ai/stores/agent-follow.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useToast } from "@/utils/toast";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { DropdownMenuCheckboxItem } from "@/ui/dropdown";
import { CrosshairIcon } from "@/ui/icons";

const USER_INPUT_EVENTS = ["pointerdown", "keydown", "wheel"] as const;

function findChatPaneId(chatId: string): string | null {
  const agentBuffer = useBufferStore
    .getState()
    .buffers.find((buffer) => buffer.type === "agent" && buffer.sessionId === chatId);
  if (!agentBuffer) return null;
  return usePaneStore.getState().actions.getPaneByBufferId(agentBuffer.id)?.id ?? null;
}

/**
 * While "Follow agent" is on and a turn runs, the editor opens the files the agent works in;
 * clicking, typing or scrolling in another pane hands the editor back. The composer keeps this
 * mounted for its chat so the hand-back works whether or not a menu is open.
 */
export function useFollowAgentInterrupt(chatId: string | null) {
  const following = useIsFollowingAgent(chatId);
  const running = useAIChatStore((state) => Boolean(chatId && state.agentRuns[chatId]));
  const { showToast } = useToast();

  useEffect(() => {
    if (!chatId || !following || !running) return;
    const handleUserInput = (event: Event) => {
      const pane =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-pane-container]")
          : null;
      const interrupted = interruptsAgentFollow({
        following,
        running,
        trusted: event.isTrusted,
        targetPaneId: pane?.dataset.paneId ?? null,
        chatPaneId: findChatPaneId(chatId),
      });
      if (!interrupted) return;
      stopFollowingAgent(chatId);
      showToast({ message: "Stopped following the agent", type: "info" });
    };
    for (const type of USER_INPUT_EVENTS) {
      document.addEventListener(type, handleUserInput, { capture: true, passive: true });
    }
    return () => {
      for (const type of USER_INPUT_EVENTS) {
        document.removeEventListener(type, handleUserInput, { capture: true });
      }
    };
  }, [chatId, following, running, showToast]);
}

/** The chat's "Follow agent" toggle, as a row of the composer's model menu. */
export function FollowAgentMenuItem({ chatId }: { chatId: string }) {
  const following = useIsFollowingAgent(chatId);
  return (
    <DropdownMenuCheckboxItem
      checked={following}
      closeOnClick={false}
      onCheckedChange={() => toggleFollowAgent(chatId)}
      title="Open the files the agent works in while its turn runs"
    >
      <CrosshairIcon />
      <span className="min-w-0 flex-1 truncate">Follow agent in editor</span>
    </DropdownMenuCheckboxItem>
  );
}
