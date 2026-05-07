import { useCallback } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { TerminalSlot } from "./terminal-slot";

interface TerminalTabProps {
  sessionId: string;
  bufferId: string;
  paneId?: string;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
  isActive?: boolean;
  isVisible?: boolean;
}

export function TerminalTab({
  sessionId,
  bufferId,
  paneId,
  initialCommand,
  workingDirectory,
  remoteConnectionId,
  isActive = true,
  isVisible = true,
}: TerminalTabProps) {
  const { closeBufferForce } = useBufferStore.use.actions();

  const handleTerminalExit = useCallback(() => {
    closeBufferForce(bufferId);
  }, [bufferId, closeBufferForce]);

  const handleActivate = useCallback(() => {
    if (paneId) {
      usePaneStore.getState().actions.setActivePane(paneId);
    }
    useBufferStore.getState().actions.setActiveBuffer(bufferId);
  }, [bufferId, paneId]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TerminalSlot
        sessionId={sessionId}
        isActive={isActive}
        isVisible={isVisible}
        onTerminalExit={handleTerminalExit}
        initialCommand={initialCommand}
        workingDirectory={workingDirectory}
        remoteConnectionId={remoteConnectionId}
        onActivate={handleActivate}
      />
    </div>
  );
}
