import { useCallback } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { XtermTerminal } from "./terminal";

interface TerminalTabProps {
  sessionId: string;
  bufferId: string;
  initialCommand?: string;
  workingDirectory?: string;
  isActive?: boolean;
}

export function TerminalTab({
  sessionId,
  bufferId,
  initialCommand,
  workingDirectory,
  isActive = true,
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
        onTerminalExit={handleTerminalExit}
        initialCommand={initialCommand}
        workingDirectory={workingDirectory}
      />
    </div>
  );
}
