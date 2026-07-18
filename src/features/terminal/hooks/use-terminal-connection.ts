import { invoke } from "@tauri-apps/api/core";
import type { IDisposable, Terminal as XtermTerminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { TerminalInput, TerminalSize } from "../types/terminal.types";
import { parseOSC7 } from "../utils/osc-parser";
import {
  getTerminalOutputFlowAction,
  getTerminalSize,
  releaseTerminalEventChannel,
  subscribeToTerminalEvents,
  terminalSizesEqual,
} from "../utils/terminal-protocol";
import { useTerminalWriteBuffer } from "./use-terminal-write-buffer";

const ESCAPE_CODE = 27;
const BEL_CODE = 7;
const DELETE_CODE = 127;
const C1_ESCAPE_CODE = 155;
const OSC_SCAN_BUFFER_LIMIT = 8192;

const isAsciiLetter = (charCode: number) =>
  (charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122);

const stripTerminalControlSequences = (rawTitle: string) => {
  let title = "";

  for (let index = 0; index < rawTitle.length; index += 1) {
    const charCode = rawTitle.charCodeAt(index);

    if (charCode === ESCAPE_CODE) {
      const nextChar = rawTitle[index + 1];

      if (nextChar === "[") {
        index += 2;
        while (index < rawTitle.length && !isAsciiLetter(rawTitle.charCodeAt(index))) {
          index += 1;
        }
        continue;
      }

      if (nextChar === "]") {
        index += 2;
        while (index < rawTitle.length && rawTitle.charCodeAt(index) !== BEL_CODE) {
          index += 1;
        }
        continue;
      }

      continue;
    }

    if (charCode <= 31 || charCode === DELETE_CODE || charCode === C1_ESCAPE_CODE) {
      continue;
    }

    title += rawTitle[index];
  }

  return title.trim();
};

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
  const oscScanBufferRef = useRef("");

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
    oscScanBufferRef.current = "";
    void flush();
  }, [connectionId, flush]);

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
    disposables.push(
      terminal.onTitleChange((rawTitle) => {
        const title = stripTerminalControlSequences(rawTitle);
        if (title) updateSession(sessionId, { title });
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
        oscScanBufferRef.current = (oscScanBufferRef.current + decoded).slice(
          -OSC_SCAN_BUFFER_LIMIT,
        );
        const newDirectory = parseOSC7(oscScanBufferRef.current);
        if (newDirectory) updateSession(sessionId, { currentDirectory: newDirectory });

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
