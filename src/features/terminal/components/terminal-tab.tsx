import { useCallback } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { XtermTerminal } from "./terminal";

interface TerminalTabProps {
  sessionId: string;
  bufferId: string;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
  isActive?: boolean;
  isVisible?: boolean;
}

export function TerminalTab({
  sessionId,
  bufferId,
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <XtermTerminal
        sessionId={sessionId}
        isActive={isActive}
        isVisible={isVisible}
        onTerminalExit={handleTerminalExit}
        initialCommand={initialCommand}
        workingDirectory={workingDirectory}
        remoteConnectionId={remoteConnectionId}
      />
    </div>
  );
}
