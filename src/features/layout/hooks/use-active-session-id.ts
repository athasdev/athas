import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useActiveBufferId } from "@/features/panes/hooks/use-pane-buffer-state";

/** The agent session in front in the centre, if the buffer in front is one. */
export function useActiveSessionId(): string | null {
  const activeBufferId = useActiveBufferId();
  return useBufferStore((state) => {
    const buffer = activeBufferId
      ? state.buffers.find((candidate) => candidate.id === activeBufferId)
      : undefined;
    return buffer?.type === "agent" ? buffer.sessionId : null;
  });
}
