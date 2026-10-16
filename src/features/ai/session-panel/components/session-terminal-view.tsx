import { useState } from "react";
import { TerminalSlot } from "@/features/terminal/components/terminal-slot";

/**
 * The session's own terminal in its working directory. It keeps running while its pane is closed
 * or the session is out of view, and takes focus only when the user asked for it.
 */
export function SessionTerminalView({
  terminalId,
  workingDirectory,
  takeFocus,
}: {
  terminalId: string;
  workingDirectory: string | undefined;
  takeFocus: boolean;
}) {
  const [isActive, setIsActive] = useState(takeFocus);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-1.5 pb-1.5">
      <TerminalSlot
        sessionId={terminalId}
        isActive={isActive}
        isVisible
        workingDirectory={workingDirectory}
        onActivate={() => setIsActive(true)}
      />
    </div>
  );
}
