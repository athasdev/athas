import { useCallback, useEffect, useRef } from "react";
import type { Terminal as TerminalType } from "@/features/terminal/types/terminal.types";
import { TerminalErrorBoundary } from "./terminal-error-boundary";
import { TerminalSlot } from "./terminal-slot";

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

  const focusTerminal = useCallback(() => {
    const ref = xtermInstanceRef.current || terminalRef.current;
    if (!ref?.focus) return;

    let attempt = 0;
    const tryFocus = () => {
      if (attempt >= 6 || !ref.focus) return;
      attempt++;
      ref.focus();

      requestAnimationFrame(() => {
        const textarea = ref.terminal?.textarea;
        if (textarea && document.activeElement !== textarea) {
          tryFocus();
        }
      });
    };

    requestAnimationFrame(() => tryFocus());
  }, []);

  const showSearch = useCallback(() => {
    if (xtermInstanceRef.current?.showSearch) {
      xtermInstanceRef.current.showSearch();
      return;
    }

    focusTerminal();
  }, [focusTerminal]);

  const handleTerminalRef = useCallback((ref: any) => {
    xtermInstanceRef.current = ref;
    terminalRef.current = ref;
  }, []);

  useEffect(() => {
    if (onRegisterRef) {
      onRegisterRef(terminal.id, { focus: focusTerminal, showSearch });
      return () => {
        onRegisterRef(terminal.id, null);
      };
    }
  }, [terminal.id, onRegisterRef, focusTerminal, showSearch]);

  useEffect(() => {
    if (isActive && onActivity) {
      onActivity(terminal.id);
    }
  }, [isActive, terminal.id, onActivity]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-terminal-id={terminal.id}>
      <TerminalErrorBoundary>
        <TerminalSlot
          sessionId={terminal.id}
          isActive={isActive}
          isVisible={isVisible}
          initialCommand={terminal.initialCommand}
          remoteConnectionId={terminal.remoteConnectionId}
          onTerminalExit={onTerminalExit}
          onTerminalRef={handleTerminalRef}
        />
      </TerminalErrorBoundary>
    </div>
  );
};

export default TerminalSession;
