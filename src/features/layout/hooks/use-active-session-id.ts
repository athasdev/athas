import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";
import { getTabSetSessionId, useTabSetsStore } from "@/features/panes/stores/tab-sets.store";

/** The agent session whose tab is in front in the centre, if the buffer in front is one. */
export function useAgentBufferSessionId(): string | null {
  const activeBufferId = useActiveBufferId();
  return useBufferStore((state) => {
    const buffer = activeBufferId
      ? state.buffers.find((candidate) => candidate.id === activeBufferId)
      : undefined;
    return buffer?.type === "agent" ? buffer.sessionId : null;
  });
}

/**
 * The agent session in front in the centre: the session whose tab set shows, even while one of
 * its files is the tab in front, or else the session whose tab is in front.
 */
export function useActiveSessionId(): string | null {
  const tabSetSessionId = useTabSetsStore((state) => getTabSetSessionId(state.activeOwner));
  const bufferSessionId = useAgentBufferSessionId();
  return tabSetSessionId ?? bufferSessionId;
}
