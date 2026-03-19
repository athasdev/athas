import { useCallback, useEffect, useRef } from "react";
import type { Terminal as TerminalType } from "@/features/terminal/types/terminal";
import { XtermTerminal } from "./terminal";
import { TerminalErrorBoundary } from "./terminal-error-boundary";

interface TerminalSessionProps {
  terminal: TerminalType;
  isActive: boolean;
  isVisible?: boolean;
  onDirectoryChange?: (terminalId: string, directory: string) => void;
  onActivity?: (terminalId: string) => void;
  onRegisterRef?: (
    terminalId: string,
    ref: { focus: () => void; showSearch: () => void } | null,
  ) => void;
  onTerminalExit?: (terminalId: string) => void;
}

const TerminalSession = ({
  terminal,
  isActive,
  isVisible = true,
  onActivity,
  onRegisterRef,
  onTerminalExit,
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

  const showSearch = useCallback(() => {
    if (xtermInstanceRef.current?.showSearch) {
      xtermInstanceRef.current.showSearch();
      return;
    }

    focusTerminal();
  }, [focusTerminal]);

  // Register ref with parent
  useEffect(() => {
    if (onRegisterRef) {
      onRegisterRef(terminal.id, { focus: focusTerminal, showSearch });
      return () => {
        onRegisterRef(terminal.id, null);
      };
    }
  }, [terminal.id, onRegisterRef, focusTerminal, showSearch]);

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
          isVisible={isVisible}
          initialCommand={terminal.initialCommand}
          onReady={() => {
            // Additional ready callback if needed
          }}
          onTerminalRef={(ref) => {
            // Store both xterm instance and focus method
            xtermInstanceRef.current = ref;
            terminalRef.current = ref;
          }}
          onTerminalExit={onTerminalExit}
          remoteConnectionId={terminal.remoteConnectionId}
        />
      </TerminalErrorBoundary>
    </div>
  );
};

export default TerminalSession;
