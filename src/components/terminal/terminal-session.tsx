import { useCallback, useEffect, useRef } from "react";
import type { Terminal as TerminalType } from "../../types/terminal";
import { TerminalErrorBoundary } from "./terminal-error-boundary";
import { XtermTerminal } from "./xterm-terminal";

interface TerminalSessionProps {
  terminal: TerminalType;
  isActive: boolean;
  onDirectoryChange?: (terminalId: string, directory: string) => void;
  onActivity?: (terminalId: string) => void;
  onRegisterRef?: (terminalId: string, ref: { focus: () => void } | null) => void;
}

const TerminalSession = ({
  terminal,
  isActive,
  onActivity,
  onRegisterRef,
}: TerminalSessionProps) => {
  const terminalRef = useRef<any>(null);

  // Focus method that can be called externally
  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  // Register ref with parent
  useEffect(() => {
    if (onRegisterRef) {
      onRegisterRef(terminal.id, { focus: focusTerminal });
      return () => {
        onRegisterRef(terminal.id, null);
      };
    }
  }, [terminal.id, onRegisterRef, focusTerminal]);

  // Handle activity tracking
  useEffect(() => {
    if (isActive && onActivity) {
      onActivity(terminal.id);
    }
  }, [isActive, terminal.id, onActivity]);

  return (
    <div className={`h-full ${isActive ? "block" : "hidden"}`} data-terminal-id={terminal.id}>
      <TerminalErrorBoundary>
        <XtermTerminal
          sessionId={terminal.id}
          isActive={isActive}
          onReady={() => {
            // Store terminal reference
            terminalRef.current = {
              focus: () => {
                const session = (window as any).terminalSessions?.[terminal.id];
                session?.terminal?.focus();
              },
            };
          }}
        />
      </TerminalErrorBoundary>
    </div>
  );
};

export default TerminalSession;
