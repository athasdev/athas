import { commands } from "@/bindings/commands";
import { useCallback, useEffect, useRef } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { emitAppEvent } from "@/utils/app-events";
import { closeTerminalConnection } from "../services/terminal-connection-lifecycle";
import type { IDisposable, Terminal } from "@xterm/xterm";
import type { TerminalInput, TerminalSize } from "../types/terminal.types";
import type { TerminalTheme } from "./use-terminal-theme";
import { parseOsc7Directory } from "../utils/terminal-osc";
import { normalizeTerminalTitle } from "../utils/terminal-title";
import { createTerminalOutputBuffer } from "../utils/terminal-output-buffer";
import {
  getTerminalOutputFlowAction,
  getTerminalSize,
  releaseTerminalEventChannel,
  subscribeToTerminalEvents,
  terminalSizesEqual,
} from "../services/terminal-protocol";
import { useTerminalWriteBuffer } from "./use-terminal-write-buffer";

interface UseTerminalConnectionOptions {
  applyTerminalTheme: (theme: TerminalTheme) => void;
  connectionId?: string;
  getTerminalTheme: () => TerminalTheme;
  initialCommand?: string;
  isInitialized: boolean;
  onTerminalExit?: (sessionId: string) => void;
  remoteConnectionId?: string;
  reuseExistingConnection?: boolean;
  sessionId: string;
  sessionSignal?: AbortSignal;
  terminal: Terminal | null;
  updateSession: (
    sessionId: string,
    updates: {
      currentDirectory?: string;
      title?: string;
    },
  ) => void;
}

export function useTerminalConnection({
  applyTerminalTheme,
  connectionId,
  getTerminalTheme,
  initialCommand,
  isInitialized,
  onTerminalExit,
  remoteConnectionId,
  reuseExistingConnection = false,
  sessionId,
  sessionSignal,
  terminal,
  updateSession,
}: UseTerminalConnectionOptions) {
  const currentConnectionIdRef = useRef<string | null>(null);
  const initialCommandSentForConnectionRef = useRef<string | null>(null);
  const onTerminalExitRef = useRef(onTerminalExit);
  const lastExitInfoRef = useRef<{ exitCode?: number | null; signal?: string | null } | null>(null);
  const hadTerminalErrorRef = useRef(false);
  const lastSizeRef = useRef<TerminalSize | null>(null);
  const outputPausedRef = useRef(false);

  const writeInput = useCallback(
    async (activeConnectionId: string, input: TerminalInput) => {
      if (remoteConnectionId) {
        await commands.remoteTerminalWrite(activeConnectionId, input);
        return;
      }
      await commands.terminalWrite(activeConnectionId, input);
    },
    [remoteConnectionId],
  );

  const {
    write,
    writeBinary: enqueueBinary,
    flush,
  } = useTerminalWriteBuffer({
    getConnectionId: () => currentConnectionIdRef.current,
    writeChunk: async (activeConnectionId, input) => {
      await writeInput(activeConnectionId, input);
    },
  });

  const writeBinary = useCallback(
    (data: string) => {
      const activeConnectionId = currentConnectionIdRef.current;
      if (!activeConnectionId || !data) return;
      const bytes = Array.from(data, (character) => character.charCodeAt(0) & 0xff);
      enqueueBinary(bytes);
    },
    [enqueueBinary],
  );

  const setOutputPaused = useCallback(
    (paused: boolean) => {
      const activeConnectionId = currentConnectionIdRef.current;
      if (!activeConnectionId || outputPausedRef.current === paused) return;

      outputPausedRef.current = paused;
      const request = remoteConnectionId
        ? commands.remoteTerminalSetPaused(activeConnectionId, paused)
        : commands.terminalSetPaused(activeConnectionId, paused);
      void request.catch(() => {
        if (currentConnectionIdRef.current !== activeConnectionId) return;
        outputPausedRef.current = !paused;
      });
    },
    [remoteConnectionId],
  );

  const sendTerminalSize = useCallback(
    (activeTerminal: Terminal) => {
      const activeConnectionId = currentConnectionIdRef.current;
      if (!activeConnectionId || sessionSignal?.aborted) return;

      const size = getTerminalSize(activeTerminal);
      if (terminalSizesEqual(lastSizeRef.current, size)) return;
      lastSizeRef.current = size;

      const request = remoteConnectionId
        ? commands.remoteTerminalResize(activeConnectionId, size)
        : commands.terminalResize(activeConnectionId, size);
      void request.catch(() => {
        if (currentConnectionIdRef.current !== activeConnectionId) return;
        lastSizeRef.current = null;
      });
    },
    [remoteConnectionId, sessionSignal],
  );

  useEffect(() => {
    onTerminalExitRef.current = onTerminalExit;
  }, [onTerminalExit]);

  useEffect(() => {
    currentConnectionIdRef.current = connectionId ?? null;
    lastExitInfoRef.current = null;
    hadTerminalErrorRef.current = false;
    lastSizeRef.current = null;
    outputPausedRef.current = false;
    if (connectionId) updateSession(sessionId, { title: "" });
    void flush();
  }, [connectionId, flush, sessionId, updateSession]);

  useEffect(() => {
    if (!terminal || !isInitialized || !connectionId || sessionSignal?.aborted) return;
    const isCurrent = () =>
      !sessionSignal?.aborted && currentConnectionIdRef.current === connectionId;

    const disposables: IDisposable[] = [];

    disposables.push(
      terminal.onData((data) => {
        if (isCurrent()) write(data);
      }),
    );
    if (terminal.onBinary)
      disposables.push(
        terminal.onBinary((data) => {
          if (isCurrent()) writeBinary(data);
        }),
      );
    disposables.push(
      terminal.onResize(() => {
        if (isCurrent()) sendTerminalSize(terminal);
      }),
    );
    disposables.push(
      terminal.onTitleChange((title) => {
        if (!isCurrent()) return;
        updateSession(sessionId, { title: normalizeTerminalTitle(title) ?? "" });
      }),
    );
    disposables.push(
      terminal.parser.registerOscHandler(7, (payload) => {
        const currentDirectory = parseOsc7Directory(payload);
        if (currentDirectory && isCurrent()) updateSession(sessionId, { currentDirectory });
        return true;
      }),
    );
    const unlistenThemeChange = themeRegistry.onThemeChange(() => {
      applyTerminalTheme(getTerminalTheme());
    });

    const outputBuffer = createTerminalOutputBuffer({
      write: (bytes, callback) => terminal.write(bytes, callback),
      onQueuedBytesChange: (queuedBytes) => {
        const action = getTerminalOutputFlowAction(queuedBytes, outputPausedRef.current);
        if (action === "pause") setOutputPaused(true);
        if (action === "resume") setOutputPaused(false);
      },
      onWriteError: () => {
        hadTerminalErrorRef.current = true;
      },
    });

    const unsubscribeEvents = subscribeToTerminalEvents(connectionId, (event) => {
      if (!isCurrent()) return;
      if (event.event === "output") {
        outputBuffer.enqueue(event.data);
        return;
      }

      if (event.event === "error") {
        hadTerminalErrorRef.current = true;
        void outputBuffer.whenDrained().then(() => {
          if (outputBuffer.isDisposed() || !isCurrent()) return;
          terminal.writeln(`\r\n\x1b[31mError: ${event.message}\x1b[0m`);
        });
        return;
      }

      if (event.event === "exit") {
        lastExitInfoRef.current = event;
        return;
      }

      const exitInfo = lastExitInfoRef.current;
      const hadError = hadTerminalErrorRef.current;
      void outputBuffer.whenDrained().then(() => {
        void closeTerminalConnection({ connectionId, remoteConnectionId }).catch(() => {});
        releaseTerminalEventChannel(connectionId);
        if (outputBuffer.isDisposed() || !isCurrent()) return;
        emitAppEvent("terminal-process-exit", {
          sessionId,
          exitCode: hadError ? null : (exitInfo?.exitCode ?? null),
          signal: exitInfo?.signal ?? null,
        });

        const exitCode = exitInfo?.exitCode;
        const signal = exitInfo?.signal;
        const exitedCleanly = !hadError && exitCode === 0 && signal == null;
        if (exitedCleanly) {
          onTerminalExitRef.current?.(sessionId);
          return;
        }
        // The view was torn down while output was still draining; there is no terminal left to
        // explain the exit in.
        if (outputBuffer.isDisposed()) return;

        if (!hadError) {
          const details =
            signal != null
              ? `signal ${signal}`
              : exitCode != null
                ? `exit code ${exitCode}`
                : "unknown status";
          terminal.writeln(`\r\n\x1b[33mTerminal process exited unexpectedly (${details}).\x1b[0m`);
        }
        terminal.writeln("\x1b[90mOpen a new terminal tab or close this one manually.\x1b[0m");
      });
    });

    sendTerminalSize(terminal);

    return () => {
      outputBuffer.dispose();
      void flush();
      if (outputPausedRef.current) setOutputPaused(false);
      for (const disposable of disposables) disposable.dispose();
      unlistenThemeChange();
      unsubscribeEvents();
    };
  }, [
    applyTerminalTheme,
    connectionId,
    flush,
    getTerminalTheme,
    isInitialized,
    remoteConnectionId,
    sendTerminalSize,
    sessionId,
    sessionSignal,
    setOutputPaused,
    terminal,
    updateSession,
    write,
    writeBinary,
  ]);

  useEffect(() => {
    if (!initialCommand || !connectionId || reuseExistingConnection) return;
    if (initialCommandSentForConnectionRef.current === connectionId) return;

    initialCommandSentForConnectionRef.current = connectionId;
    const timeoutId = window.setTimeout(() => {
      if (sessionSignal?.aborted || currentConnectionIdRef.current !== connectionId) return;
      write(`${initialCommand}\n`);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [connectionId, initialCommand, reuseExistingConnection, sessionSignal, write]);

  const writeBuffered = useCallback(
    (data: string) => {
      if (!sessionSignal?.aborted) write(data);
    },
    [sessionSignal, write],
  );

  return {
    currentConnectionIdRef,
    sendTerminalSize,
    writeBuffered,
  };
}
