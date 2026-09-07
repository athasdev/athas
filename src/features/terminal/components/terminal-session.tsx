import { useCallback, useEffect, useRef } from "react";
import type {
  Terminal as TerminalType,
  TerminalCommandNavigationDirection,
  TerminalEmulatorHandle,
  TerminalSessionHandle,
} from "@/features/terminal/types/terminal.types";
import { TerminalErrorBoundary } from "./terminal-error-boundary";
import { TerminalSlot } from "./terminal-slot";

interface TerminalSessionProps {
  terminal: TerminalType;
  isActive: boolean;
  isVisible?: boolean;
  onDirectoryChange?: (terminalId: string, directory: string) => void;
  onActivity?: (terminalId: string) => void;
  onRegisterRef?: (terminalId: string, ref: TerminalSessionHandle | null) => void;
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
        const terminalElement = ref.terminal?.element;
        const activeElement = document.activeElement;
        const hasTerminalFocus =
          activeElement === textarea ||
          activeElement === terminalElement ||
          terminalElement?.contains(activeElement);

        if (textarea && !hasTerminalFocus) {
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

  const navigateCommand = useCallback((direction: TerminalCommandNavigationDirection) => {
    xtermInstanceRef.current?.navigateCommand(direction);
  }, []);

  const clear = useCallback(() => {
    xtermInstanceRef.current?.clear();
  }, []);

  const selectAll = useCallback(() => {
    xtermInstanceRef.current?.selectAll();
  }, []);

  const copyLastCommandOutput = useCallback(() => {
    xtermInstanceRef.current?.copyLastCommandOutput();
  }, []);

  const handleTerminalRef = useCallback((ref: TerminalEmulatorHandle) => {
    xtermInstanceRef.current = ref;
    terminalRef.current = ref;
  }, []);

  useEffect(() => {
    if (onRegisterRef) {
      onRegisterRef(terminal.id, {
        focus: focusTerminal,
        showSearch,
        navigateCommand,
        clear,
        selectAll,
        copyLastCommandOutput,
      });
      return () => {
        onRegisterRef(terminal.id, null);
      };
    }
  }, [
    terminal.id,
    onRegisterRef,
    focusTerminal,
    showSearch,
    navigateCommand,
    clear,
    selectAll,
    copyLastCommandOutput,
  ]);

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
          shell={terminal.shell}
          initialCommand={terminal.initialCommand}
          environment={terminal.environment}
          workingDirectory={terminal.currentDirectory}
          remoteConnectionId={terminal.remoteConnectionId}
          onTerminalExit={onTerminalExit}
          onTerminalRef={handleTerminalRef}
        />
      </TerminalErrorBoundary>
    </div>
  );
};

export default TerminalSession;
