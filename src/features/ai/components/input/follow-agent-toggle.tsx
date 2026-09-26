import { useEffect } from "react";
import { interruptsAgentFollow } from "@/features/ai/lib/agent-follow";
import { stopFollowingAgent, toggleFollowAgent } from "@/features/ai/services/agent-follow-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useIsFollowingAgent } from "@/features/ai/stores/agent-follow.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { Button } from "@/ui/button";
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
 * The chat's "Follow agent" toggle. While it is on and a turn runs, the editor opens the files
 * the agent works in; clicking, typing or scrolling in another pane hands the editor back.
 */
export function FollowAgentToggle({ chatId }: { chatId: string }) {
  const following = useIsFollowingAgent(chatId);
  const running = useAIChatStore((state) => Boolean(state.agentRuns[chatId]));
  const { showToast } = useToast();

  useEffect(() => {
    if (!following || !running) return;
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

  const label = following ? "Stop following the agent" : "Follow the agent in the editor";
  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      active={following}
      aria-pressed={following}
      tooltip={label}
      aria-label={label}
      onClick={() => toggleFollowAgent(chatId)}
    >
      <CrosshairIcon />
    </Button>
  );
}
