import { useState } from "react";
import { TerminalSlot } from "@/features/terminal/components/terminal-slot";
import { useSessionPanelStore } from "../stores/session-panel.store";

/**
 * The session's own terminal in its working directory. It keeps running while the card is
 * collapsed or the session is out of view, and takes focus only when the user asked for it.
 */
export function SessionTerminalView({
  chatId,
  terminalId,
  workingDirectory,
}: {
  chatId: string;
  terminalId: string;
  workingDirectory: string | undefined;
}) {
  const [isActive, setIsActive] = useState(() =>
    useSessionPanelStore.getState().actions.consumeFocus(chatId, "terminal"),
  );

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
