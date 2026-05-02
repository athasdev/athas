import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { IDisposable, Terminal as XtermTerminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { parseOSC7 } from "../utils/osc-parser";
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
  const currentInputLineRef = useRef("");
  const initialCommandSentForConnectionRef = useRef<string | null>(null);
  const onTerminalExitRef = useRef(onTerminalExit);
  const explicitExitRequestedRef = useRef(false);
  const lastExitInfoRef = useRef<{ exitCode?: number | null; signal?: string | null } | null>(null);
  const outputBufferRef = useRef("");
  const outputFlushFrameRef = useRef<number | null>(null);
  const { write, flush } = useTerminalWriteBuffer({
    getConnectionId: () => currentConnectionIdRef.current,
    writeChunk: async (activeConnectionId, data) => {
      await invoke(remoteConnectionId ? "remote_terminal_write" : "terminal_write", {
        id: activeConnectionId,
        data,
      });
    },
  });

  useEffect(() => {
    onTerminalExitRef.current = onTerminalExit;
  }, [onTerminalExit]);

  useEffect(() => {
    currentConnectionIdRef.current = connectionId ?? null;
  }, [connectionId]);

  useEffect(() => {
    explicitExitRequestedRef.current = false;
    lastExitInfoRef.current = null;
  }, [connectionId]);

  useEffect(() => {
    return () => {
      if (outputFlushFrameRef.current !== null) {
        cancelAnimationFrame(outputFlushFrameRef.current);
      }
      outputBufferRef.current = "";
    };
  }, []);

  useEffect(() => {
    if (!terminal || !isInitialized || !connectionId) return;

    const disposables: IDisposable[] = [];

    const flushOutputBuffer = () => {
      outputFlushFrameRef.current = null;
      const pendingOutput = outputBufferRef.current;
      if (!pendingOutput) return;

      outputBufferRef.current = "";
      terminal.write(pendingOutput);

      const newDirectory = parseOSC7(pendingOutput);
      if (newDirectory) updateSession(sessionId, { currentDirectory: newDirectory });
    };

    const scheduleOutputFlush = () => {
      if (outputFlushFrameRef.current !== null) return;
      outputFlushFrameRef.current = window.requestAnimationFrame(flushOutputBuffer);
    };

    disposables.push(
      terminal.onData((data) => {
        const activeConnectionId = currentConnectionIdRef.current || connectionId;
        const hasNewline = data.includes("\n") || data.includes("\r");

        if (hasNewline) {
          currentInputLineRef.current += data;
          if (/^\s*exit\s*$/i.test(currentInputLineRef.current.trim())) {
            explicitExitRequestedRef.current = true;
            currentInputLineRef.current = "";
            write(data);
            window.setTimeout(() => {
              void invoke(remoteConnectionId ? "close_remote_terminal" : "close_terminal", {
                id: activeConnectionId,
              }).catch(() => {});
            }, 100);
            return;
          }
          currentInputLineRef.current = "";
        } else {
          currentInputLineRef.current += data;
          if (currentInputLineRef.current.length > 1000) {
            currentInputLineRef.current = currentInputLineRef.current.slice(-100);
          }
        }

        write(data);
      }),
    );

    disposables.push(
      terminal.onKey(({ domEvent: event }) => {
        const shortcuts: Record<string, string> = {
          "meta+Backspace": "\u0015",
          "ctrl+u": "\u0015",
          "meta+k": "\u000c",
          "alt+Backspace": "\u0017",
          "meta+a": "\u0001",
          "meta+e": "\u0005",
        };

        const key = `${event.metaKey ? "meta+" : ""}${event.ctrlKey ? "ctrl+" : ""}${event.altKey ? "alt+" : ""}${event.key}`;
        if (shortcuts[key]) {
          event.preventDefault();
          write(shortcuts[key]);
          return;
        }

        // Modifier+Enter: send CSI u sequences so TUI apps can distinguish them
        if (event.key === "Enter") {
          if (event.shiftKey) {
            event.preventDefault();
            write("\x1b[13;2u"); // Shift+Enter
            return;
          }
          if (event.altKey) {
            event.preventDefault();
            write("\x1b[13;3u"); // Alt+Enter
            return;
          }
        }

        // Shift+Tab: send reverse-tab escape sequence
        if (event.key === "Tab" && event.shiftKey) {
          event.preventDefault();
          write("\x1b[Z");
          return;
        }

        if (event.metaKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          write(event.key === "ArrowLeft" ? "\u0001" : "\u0005");
          return;
        }

        if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          write(event.key === "ArrowLeft" ? "\u001bb" : "\u001bf");
        }
      }),
    );

    disposables.push(
      terminal.onResize(({ cols, rows }) => {
        void invoke(remoteConnectionId ? "remote_terminal_resize" : "terminal_resize", {
          id: connectionId,
          rows,
          cols,
        }).catch(() => {});
      }),
    );

    disposables.push(
      terminal.onSelectionChange(() => {
        const selection = terminal.getSelection();
        if (selection) updateSession(sessionId, { selection });
      }),
    );

    disposables.push(
      terminal.onTitleChange((rawTitle) => {
        // Strip ANSI escape sequences and control characters from title
        const title = rawTitle
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
          .replace(/\x1b\][^\x07]*\x07/g, "")
          .replace(/[\x00-\x1f\x7f\x9b]/g, "")
          .trim();
        if (title) {
          updateSession(sessionId, { title });
        }
      }),
    );

    const unlistenThemeChange = themeRegistry.onThemeChange(() => {
      terminal.options.theme = getTerminalTheme();
    });

    const unlistenOutput = listen(`pty-output-${connectionId}`, (event) => {
      const data = event.payload as { data: string };
      outputBufferRef.current += data.data;
      scheduleOutputFlush();
    });

    const unlistenError = listen(`pty-error-${connectionId}`, (event) => {
      const error = event.payload as { error: string };
      terminal.writeln(`\r\n\x1b[31mError: ${error.error}\x1b[0m`);
    });

    const unlistenExit = listen(`pty-exit-${connectionId}`, (event) => {
      const payload = event.payload as { exitCode?: number | null; signal?: string | null };
      lastExitInfoRef.current = payload;
    });

    const unlistenClosed = listen(`pty-closed-${connectionId}`, async () => {
      try {
        await invoke(remoteConnectionId ? "close_remote_terminal" : "close_terminal", {
          id: connectionId,
        });
      } catch {}

      if (explicitExitRequestedRef.current) {
        onTerminalExitRef.current?.(sessionId);
        return;
      }

      const exitCode = lastExitInfoRef.current?.exitCode;
      const signal = lastExitInfoRef.current?.signal;
      const details =
        signal != null
          ? `signal ${signal}`
          : exitCode != null
            ? `exit code ${exitCode}`
            : "unknown status";

      terminal.writeln(`\r\n\x1b[33mTerminal process exited unexpectedly (${details}).\x1b[0m`);
      terminal.writeln("\x1b[90mOpen a new terminal tab or close this one manually.\x1b[0m");
    });

    return () => {
      if (outputFlushFrameRef.current !== null) {
        cancelAnimationFrame(outputFlushFrameRef.current);
        flushOutputBuffer();
      }
      void flush();
      for (const disposable of disposables) {
        disposable.dispose();
      }
      unlistenThemeChange();
      unlistenOutput.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenExit.then((fn) => fn());
      unlistenClosed.then((fn) => fn());
    };
  }, [
    connectionId,
    flush,
    getTerminalTheme,
    isInitialized,
    sessionId,
    terminal,
    updateSession,
    write,
    remoteConnectionId,
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
    writeBuffered: write,
  };
}
