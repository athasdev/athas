import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useSettingsStore } from "@/features/settings/store";
import { useTerminalTheme } from "@/features/terminal/hooks/use-terminal-theme";
import { useProjectStore } from "@/stores/project-store";
import { cn } from "@/utils/cn";
import "@xterm/xterm/css/xterm.css";
import "@/features/terminal/styles/terminal.css";

interface ExternalEditorTerminalProps {
  filePath: string;
  fileName: string;
  terminalConnectionId: string;
  onEditorExit?: () => void;
}

export const ExternalEditorTerminal = ({
  filePath,
  terminalConnectionId,
  onEditorExit,
}: ExternalEditorTerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isInitializingRef = useRef(false);
  const hasExecutedCommandRef = useRef(false);
  const initFitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const themeRefreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  const { fontSize: editorFontSize, fontFamily: editorFontFamily } = useEditorSettingsStore();
  const { rootFolderPath } = useProjectStore();
  const { settings } = useSettingsStore();
  const { getTerminalTheme } = useTerminalTheme();

  const getEditorCommand = useCallback(
    (path: string): string => {
      const relativePath = rootFolderPath ? path.replace(rootFolderPath, ".") : path;

      switch (settings.externalEditor) {
        case "nvim":
          return `nvim "${relativePath}"`;
        case "helix":
          return `hx "${relativePath}"`;
        case "vim":
          return `vim "${relativePath}"`;
        case "nano":
          return `nano "${relativePath}"`;
        case "emacs":
          return `emacs -nw "${relativePath}"`;
        case "custom":
          return settings.customEditorCommand.replace("$FILE", `"${relativePath}"`);
        default:
          return `nvim "${relativePath}"`;
      }
    },
    [settings.externalEditor, settings.customEditorCommand, rootFolderPath],
  );

  const initializeTerminal = useCallback(() => {
    console.log("initializeTerminal called", {
      terminalRef: terminalRef.current,
      hasXterm: !!xtermRef.current,
      isInitializing: isInitializingRef.current,
    });

    if (!terminalRef.current || xtermRef.current || isInitializingRef.current) {
      console.log("initializeTerminal: skipping initialization");
      return;
    }

    isInitializingRef.current = true;
    console.log("initializeTerminal: creating terminal");

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: editorFontSize,
      fontFamily: `${editorFontFamily}, Menlo, Monaco, "Courier New", monospace`,
      theme: getTerminalTheme(),
      allowProposedApi: true,
      smoothScrollDuration: 100,
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const unicodeAddon = new Unicode11Addon();
    const clipboardAddon = new ClipboardAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicodeAddon);
    terminal.loadAddon(clipboardAddon);

    terminal.unicode.activeVersion = "11";

    console.log("initializeTerminal: opening terminal in DOM");
    terminal.open(terminalRef.current);
    console.log("initializeTerminal: terminal opened");

    if (initFitTimeoutRef.current) {
      clearTimeout(initFitTimeoutRef.current);
    }
    initFitTimeoutRef.current = setTimeout(() => {
      if (fitAddon && terminalRef.current) {
        fitAddon.fit();
        console.log("initializeTerminal: terminal fitted");
      }
      initFitTimeoutRef.current = null;
    }, 150);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.onData((data) => {
      invoke("terminal_write", { id: terminalConnectionId, data }).catch((e) => {
        console.error("Failed to write to external editor terminal:", e);
      });
    });

    terminal.onKey(({ domEvent }) => {
      const e = domEvent;

      if ((e.metaKey && e.key === "Backspace") || (e.ctrlKey && e.key === "u")) {
        e.preventDefault();
        invoke("terminal_write", { id: terminalConnectionId, data: "\u0015" }).catch((e) => {
          console.error("Failed to write to terminal:", e);
        });
        return;
      }

      if (e.metaKey && e.key === "k") {
        e.preventDefault();
        invoke("terminal_write", { id: terminalConnectionId, data: "\u000c" }).catch((e) => {
          console.error("Failed to write to terminal:", e);
        });
        return;
      }

      if (e.altKey && e.key === "Backspace") {
        e.preventDefault();
        invoke("terminal_write", { id: terminalConnectionId, data: "\u0017" }).catch((e) => {
          console.error("Failed to write to terminal:", e);
        });
        return;
      }
    });

    terminal.attachCustomKeyEventHandler(() => {
      return true;
    });

    // Set up event listeners asynchronously
    const setupListeners = async () => {
      try {
        const outputEventName = `pty-output-${terminalConnectionId}`;
        const closedEventName = `pty-closed-${terminalConnectionId}`;
        const errorEventName = `pty-error-${terminalConnectionId}`;

        console.log("setupListeners: setting up listener for", outputEventName);

        const unlisten = await listen<{ data: string }>(outputEventName, (event) => {
          terminal.write(event.payload.data);
        });

        const closedUnlisten = await listen(closedEventName, () => {
          if (onEditorExit) {
            onEditorExit();
          }
        });

        const errorUnlisten = await listen<{ error: string }>(errorEventName, (event) => {
          console.error("Terminal error:", event.payload.error);
        });

        // Store cleanup functions
        (terminal as unknown as { _cleanupListeners: () => void })._cleanupListeners = () => {
          unlisten();
          closedUnlisten();
          errorUnlisten();
        };
      } catch (error) {
        console.error("Failed to set up terminal event listeners:", error);
      }
    };

    setupListeners();

    isInitializingRef.current = false;
    console.log("initializeTerminal: initialization complete");

    terminal.focus();

    if (!hasExecutedCommandRef.current) {
      hasExecutedCommandRef.current = true;
      const command = getEditorCommand(filePath);
      console.log("initializeTerminal: executing command:", command);
      setTimeout(() => {
        invoke("terminal_write", { id: terminalConnectionId, data: `${command}\n` })
          .then(() => {
            console.log("initializeTerminal: command sent successfully");
          })
          .catch((e) => {
            console.error("Failed to execute editor command:", e);
          });
      }, 200);
    }
  }, [
    editorFontSize,
    editorFontFamily,
    getTerminalTheme,
    terminalConnectionId,
    filePath,
    getEditorCommand,
    onEditorExit,
  ]);

  useEffect(() => {
    console.log("ExternalEditorTerminal: useEffect running", { filePath, terminalConnectionId });
    initializeTerminal();

    return () => {
      console.log("ExternalEditorTerminal: cleanup running");
      if (initFitTimeoutRef.current) {
        clearTimeout(initFitTimeoutRef.current);
      }
      if (themeRefreshTimeoutRef.current) {
        clearTimeout(themeRefreshTimeoutRef.current);
      }
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
      }

      if (xtermRef.current) {
        // Call cleanup listeners if available
        const cleanup = (xtermRef.current as unknown as { _cleanupListeners?: () => void })
          ._cleanupListeners;
        if (cleanup) {
          cleanup();
        }
        xtermRef.current.dispose();
        xtermRef.current = null;
      }
    };
  }, [initializeTerminal]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = editorFontSize;
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    }
  }, [editorFontSize]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontFamily = `${editorFontFamily}, Menlo, Monaco, "Courier New", monospace`;
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    }
  }, [editorFontFamily]);

  useEffect(() => {
    if (xtermRef.current) {
      if (themeRefreshTimeoutRef.current) {
        clearTimeout(themeRefreshTimeoutRef.current);
      }

      themeRefreshTimeoutRef.current = setTimeout(() => {
        if (xtermRef.current) {
          xtermRef.current.options.theme = getTerminalTheme();
        }
        themeRefreshTimeoutRef.current = null;
      }, 50);
    }
  }, [settings.theme, getTerminalTheme]);

  useEffect(() => {
    const handleResize = () => {
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
      }

      resizeRafRef.current = requestAnimationFrame(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();

          if (xtermRef.current) {
            const rows = xtermRef.current.rows;
            const cols = xtermRef.current.cols;

            invoke("terminal_resize", {
              id: terminalConnectionId,
              rows,
              cols,
            }).catch((e) => {
              console.error("Failed to resize terminal:", e);
            });
          }
        }
        resizeRafRef.current = null;
      });
    };

    const resizeObserver = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, [terminalConnectionId]);

  return (
    <div className="flex size-full flex-col bg-primary-bg">
      <div
        ref={terminalRef}
        className={cn("size-full flex-1 overflow-hidden", "focus:outline-none")}
        style={{ padding: "8px" }}
      />
    </div>
  );
};
