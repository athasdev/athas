import { invoke } from "@tauri-apps/api/core";
import type { IDisposable, Terminal as XtermTerminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { TerminalInput, TerminalSize } from "../types/terminal.types";
import { TerminalOscStream } from "../utils/terminal-osc-stream";
import {
  getTerminalOutputFlowAction,
  getTerminalSize,
  releaseTerminalEventChannel,
  subscribeToTerminalEvents,
  terminalSizesEqual,
} from "../utils/terminal-protocol";
import { useTerminalWriteBuffer } from "./use-terminal-write-buffer";

interface UseTerminalConnectionOptions {
  connectionId?: string;
  getTerminalTheme: () => NonNullable<XtermTerminal["options"]["theme"]>;
  initialCommand?: string;
  isInitialized: boolean;
  onTerminalExit?: (sessionId: string) => void;
  remoteConnectionId?: string;
  reuseExistingConnection?: boolean;
  sessionId: string;
  terminal: XtermTerminal | null;
  updateSession: (
    sessionId: string,
    updates: {
      currentDirectory?: string;
      selection?: string;
      title?: string;
    },
  ) => void;
}

export function useTerminalConnection({
  connectionId,
  getTerminalTheme,
  initialCommand,
  isInitialized,
  onTerminalExit,
  remoteConnectionId,
  reuseExistingConnection = false,
  sessionId,
  terminal,
  updateSession,
}: UseTerminalConnectionOptions) {
  const currentConnectionIdRef = useRef<string | null>(null);
  const initialCommandSentForConnectionRef = useRef<string | null>(null);
  const onTerminalExitRef = useRef(onTerminalExit);
  const lastExitInfoRef = useRef<{ exitCode?: number | null; signal?: string | null } | null>(null);
  const lastSizeRef = useRef<TerminalSize | null>(null);
  const queuedOutputBytesRef = useRef(0);
  const outputPausedRef = useRef(false);
  const outputDecoderRef = useRef(new TextDecoder());
  const oscStreamRef = useRef(new TerminalOscStream());

  const writeInput = useCallback(
    async (activeConnectionId: string, input: TerminalInput) => {
      await invoke(remoteConnectionId ? "remote_terminal_write" : "terminal_write", {
        id: activeConnectionId,
        input,
      });
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
      void invoke(remoteConnectionId ? "remote_terminal_set_paused" : "terminal_set_paused", {
        id: activeConnectionId,
        paused,
      }).catch(() => {
        outputPausedRef.current = !paused;
      });
    },
    [remoteConnectionId],
  );

  const sendTerminalSize = useCallback(
    (activeTerminal: XtermTerminal) => {
      const activeConnectionId = currentConnectionIdRef.current;
      if (!activeConnectionId) return;

      const size = getTerminalSize(activeTerminal);
      if (terminalSizesEqual(lastSizeRef.current, size)) return;
      lastSizeRef.current = size;

      void invoke(remoteConnectionId ? "remote_terminal_resize" : "terminal_resize", {
        id: activeConnectionId,
        size,
      }).catch(() => {
        lastSizeRef.current = null;
      });
    },
    [remoteConnectionId],
  );

  useEffect(() => {
    onTerminalExitRef.current = onTerminalExit;
  }, [onTerminalExit]);

  useEffect(() => {
    currentConnectionIdRef.current = connectionId ?? null;
    lastExitInfoRef.current = null;
    lastSizeRef.current = null;
    queuedOutputBytesRef.current = 0;
    outputPausedRef.current = false;
    outputDecoderRef.current = new TextDecoder();
    oscStreamRef.current.reset();
    if (connectionId) updateSession(sessionId, { title: "" });
    void flush();
  }, [connectionId, flush, sessionId, updateSession]);

  useEffect(() => {
    if (!terminal || !isInitialized || !connectionId) return;

    const disposables: IDisposable[] = [];

    disposables.push(terminal.onData(write));
    disposables.push(terminal.onBinary(writeBinary));
    disposables.push(terminal.onResize(() => sendTerminalSize(terminal)));
    disposables.push(
      terminal.onSelectionChange(() => {
        const selection = terminal.getSelection();
        if (selection) updateSession(sessionId, { selection });
      }),
    );
    const unlistenThemeChange = themeRegistry.onThemeChange(() => {
      terminal.options.theme = getTerminalTheme();
    });

    const unsubscribeEvents = subscribeToTerminalEvents(connectionId, (event) => {
      if (event.event === "output") {
        const bytes = Uint8Array.from(event.data);
        queuedOutputBytesRef.current += bytes.byteLength;

        if (
          getTerminalOutputFlowAction(queuedOutputBytesRef.current, outputPausedRef.current) ===
          "pause"
        ) {
          setOutputPaused(true);
        }

        const decoded = outputDecoderRef.current.decode(bytes, { stream: true });
        const oscUpdates = oscStreamRef.current.feed(decoded);
        if (oscUpdates.title !== undefined || oscUpdates.currentDirectory !== undefined) {
          updateSession(sessionId, oscUpdates);
        }

        terminal.write(bytes, () => {
          queuedOutputBytesRef.current = Math.max(
            0,
            queuedOutputBytesRef.current - bytes.byteLength,
          );
          if (
            getTerminalOutputFlowAction(queuedOutputBytesRef.current, outputPausedRef.current) ===
            "resume"
          ) {
            setOutputPaused(false);
          }
        });
        return;
      }

      if (event.event === "error") {
        terminal.writeln(`\r\n\x1b[31mError: ${event.message}\x1b[0m`);
        return;
      }

      if (event.event === "exit") {
        lastExitInfoRef.current = event;
        return;
      }

      void invoke(remoteConnectionId ? "close_remote_terminal" : "close_terminal", {
        id: connectionId,
      }).catch(() => {});
      releaseTerminalEventChannel(connectionId);

      const exitCode = lastExitInfoRef.current?.exitCode;
      const signal = lastExitInfoRef.current?.signal;
      if (exitCode === 0 && signal == null) {
        onTerminalExitRef.current?.(sessionId);
        return;
      }

      const details =
        signal != null
          ? `signal ${signal}`
          : exitCode != null
            ? `exit code ${exitCode}`
            : "unknown status";
      terminal.writeln(`\r\n\x1b[33mTerminal process exited unexpectedly (${details}).\x1b[0m`);
      terminal.writeln("\x1b[90mOpen a new terminal tab or close this one manually.\x1b[0m");
    });

    sendTerminalSize(terminal);

    return () => {
      void flush();
      if (outputPausedRef.current) setOutputPaused(false);
      for (const disposable of disposables) disposable.dispose();
      unlistenThemeChange();
      unsubscribeEvents();
    };
  }, [
    connectionId,
    flush,
    getTerminalTheme,
    isInitialized,
    remoteConnectionId,
    sendTerminalSize,
    sessionId,
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
      write(`${initialCommand}\n`);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [connectionId, initialCommand, reuseExistingConnection, write]);

  return {
    currentConnectionIdRef,
    sendTerminalSize,
    writeBuffered: write,
  };
}
