import { useCallback, useEffect, useRef } from "react";
import type { Terminal as TerminalType } from "../../types/terminal";
import { TerminalErrorBoundary } from "./terminal-error-boundary";
import { XtermTerminal } from "./xterm-terminal";

interface TerminalSessionProps {
  terminal: TerminalType;
  isActive: boolean;
  onDirectoryChange?: (terminalId: string, directory: string) => void;
  onActivity?: (terminalId: string) => void;
  onRegisterRef?: (
    terminalId: string,
    ref: { focus: () => void; resize: () => void } | null,
  ) => void;
}

const TerminalSession = ({
  terminal,
  isActive,
  onActivity,
  onRegisterRef,
}: TerminalSessionProps) => {
  const xtermRef = useRef<{ focus: () => void; resize: () => void } | null>(null);

  // Focus method that can be called externally
  const focusTerminal = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  // Resize method that can be called externally
  const resizeTerminal = useCallback(() => {
    xtermRef.current?.resize();
  }, []);

  // Register ref with parent
  useEffect(() => {
    if (onRegisterRef) {
      onRegisterRef(terminal.id, { focus: focusTerminal, resize: resizeTerminal });
      return () => {
        onRegisterRef(terminal.id, null);
      };
    }
  }, [terminal.id, onRegisterRef, focusTerminal, resizeTerminal]);

  // Handle activity tracking
  useEffect(() => {
    if (isActive && onActivity) {
      onActivity(terminal.id);
    }
  }, [isActive, terminal.id, onActivity]);

  return (
    <div className="block h-full" data-terminal-id={terminal.id}>
      <TerminalErrorBoundary>
        <XtermTerminal
          sessionId={terminal.id}
          isActive={isActive}
          onReady={(focusMethod, resizeMethod) => {
            xtermRef.current = { focus: focusMethod, resize: resizeMethod };
          }}
        />
      </TerminalErrorBoundary>
    </div>
  );
};

export default TerminalSession;
