import { useCallback, useEffect, useRef } from "react";
import type { Terminal as TerminalType } from "@/types/terminal";
import { XtermTerminal } from "./terminal";
import { TerminalErrorBoundary } from "./terminal-error-boundary";

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
  const xtermInstanceRef = useRef<any>(null);

  // Focus method that can be called externally
  const focusTerminal = useCallback(() => {
    // Try multiple focus methods to ensure it works
    if (xtermInstanceRef.current?.focus) {
      xtermInstanceRef.current.focus();
    } else if (terminalRef.current?.focus) {
      terminalRef.current.focus();
    }
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
    <div className="h-full" data-terminal-id={terminal.id}>
      <TerminalErrorBoundary>
        <XtermTerminal
          sessionId={terminal.id}
          isActive={isActive}
          onReady={() => {
            // Additional ready callback if needed
          }}
          onTerminalRef={(ref) => {
            // Store both xterm instance and focus method
            xtermInstanceRef.current = ref;
            terminalRef.current = ref;
          }}
        />
      </TerminalErrorBoundary>
    </div>
  );
};

export default TerminalSession;
