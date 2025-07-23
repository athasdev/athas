import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import type { Terminal as TerminalType } from "../../types/terminal";
import { TerminalRenderer } from "./terminal-renderer";
import { VirtualizedTerminal } from "./terminal-virtualizer";

interface TerminalSessionProps {
  terminal: TerminalType;
  isActive: boolean;
  onDirectoryChange?: (terminalId: string, directory: string) => void;
  onActivity?: (terminalId: string) => void;
  onRegisterRef?: (terminalId: string, ref: { focus: () => void } | null) => void;
}

interface LineItem {
  lexeme: string;
  width: number;
  is_underline: boolean;
  is_bold: boolean;
  is_italic: boolean;
  background_color?: any;
  foreground_color?: any;
}

interface TerminalEvent {
  type: "screenUpdate" | "cursorMove";
  screen?: LineItem[][];
  cursor_line?: number;
  cursor_col?: number;
  line?: number;
  col?: number;
}

interface TerminalConfig {
  kind: {
    $type: "local";
    workingDirectory?: string;
    shell?: string;
  };
  workingDir?: string;
  shellCommand?: string;
  environment?: Record<string, string>;
  lines: number;
  cols: number;
}

const TerminalSession = ({
  terminal,
  isActive,
  onDirectoryChange: _onDirectoryChange,
  onActivity,
  onRegisterRef,
}: TerminalSessionProps) => {
  const sessionRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [screen, setScreen] = useState<LineItem[][]>([]);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [terminalSize, setTerminalSize] = useState({ rows: 24, cols: 80 });
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate terminal size based on container dimensions
  const calculateTerminalSize = useCallback(() => {
    if (terminalRef.current) {
      const rect = terminalRef.current.getBoundingClientRect();
      const charWidth = 7.2; // Approximate character width in pixels for monospace font
      const lineHeight = 14; // Approximate line height in pixels

      const cols = Math.floor((rect.width - 24) / charWidth); // Subtract padding
      const rows = Math.floor((rect.height - 20) / lineHeight); // Subtract padding

      return {
        rows: Math.max(rows, 10),
        cols: Math.max(cols, 40),
      };
    }
    return { rows: 24, cols: 80 };
  }, []);

  // Initialize terminal connection when active
  useEffect(() => {
    if (isActive && !connectionId) {
      const initializeTerminal = async () => {
        try {
          const size = calculateTerminalSize();
          setTerminalSize(size);

          const config: TerminalConfig = {
            kind: {
              $type: "local",
              workingDirectory: terminal.currentDirectory,
              shell: terminal.shell || undefined,
            },
            lines: size.rows,
            cols: size.cols,
          };

          const id: string = await invoke("create_terminal_connection", { config });
          setConnectionId(id);
          setIsConnected(true);

          // Listen for terminal events with RAF for smooth rendering
          const unlisten = await listen(`terminal-event-${id}`, (event: any) => {
            const terminalEvent = event.payload as TerminalEvent;

            // Use requestAnimationFrame for smooth updates
            requestAnimationFrame(() => {
              if (terminalEvent.type === "screenUpdate" && terminalEvent.screen) {
                setScreen(terminalEvent.screen);
                setCursorLine(terminalEvent.cursor_line!);
                setCursorCol(terminalEvent.cursor_col!);
              } else if (terminalEvent.type === "cursorMove") {
                // Lightweight cursor-only update
                setCursorLine(terminalEvent.line!);
                setCursorCol(terminalEvent.col!);
              }
            });

            if (onActivity) {
              onActivity(terminal.id);
            }
          });

          // Listen for disconnect events
          const unlistenDisconnect = await listen(`terminal-disconnect-${id}`, () => {
            setIsConnected(false);
            setConnectionId(null);
          });

          return () => {
            unlisten();
            unlistenDisconnect();
          };
        } catch (error) {
          console.error("Failed to initialize terminal:", error);
        }
      };

      initializeTerminal();
    }
  }, [isActive, connectionId, terminal, calculateTerminalSize, onActivity]);

  // Focus method that can be called externally
  const focusTerminal = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
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

  // Auto-focus hidden input when terminal becomes active
  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive]);

  // Auto-scroll to bottom when screen updates with RAF for smoothness
  useEffect(() => {
    if (terminalRef.current && isActive && !isUserScrolling) {
      const terminal = terminalRef.current;
      // Use requestAnimationFrame for smooth scrolling
      requestAnimationFrame(() => {
        terminal.scrollTop = terminal.scrollHeight;
      });
    }
  }, [screen, isActive, isUserScrolling]);

  // Handle scroll events to detect user scrolling
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = terminal;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5; // 5px tolerance

      if (!isAtBottom) {
        setIsUserScrolling(true);
        // Clear any existing timeout
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        // Reset user scrolling after 3 seconds of no scroll activity
        scrollTimeoutRef.current = setTimeout(() => {
          setIsUserScrolling(false);
        }, 3000);
      } else {
        setIsUserScrolling(false);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
          scrollTimeoutRef.current = null;
        }
      }
    };

    // Handle mouse wheel events
    const handleWheel = (e: WheelEvent) => {
      // Allow natural scrolling
      const { scrollTop, scrollHeight, clientHeight } = terminal;
      const maxScroll = scrollHeight - clientHeight;

      // Check if we can scroll in the direction of the wheel
      if ((e.deltaY > 0 && scrollTop < maxScroll) || (e.deltaY < 0 && scrollTop > 0)) {
        handleScroll();
      }
    };

    terminal.addEventListener("scroll", handleScroll, { passive: true });
    terminal.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      terminal.removeEventListener("scroll", handleScroll);
      terminal.removeEventListener("wheel", handleWheel);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Handle terminal resize with debouncing
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null;

    const handleResize = async () => {
      if (connectionId && terminalRef.current) {
        const size = calculateTerminalSize();
        if (size.rows !== terminalSize.rows || size.cols !== terminalSize.cols) {
          setTerminalSize(size);
          try {
            await invoke("resize_terminal", {
              connectionId,
              lines: size.rows,
              cols: size.cols,
            });
          } catch (error) {
            console.error("Failed to resize terminal:", error);
          }
        }
      }
    };

    const debouncedResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      // Debounce resize events by 100ms to avoid excessive calls
      resizeTimeout = setTimeout(handleResize, 100);
    };

    const resizeObserver = new ResizeObserver(debouncedResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
    };
  }, [connectionId, terminalSize, calculateTerminalSize]);

  // Send input to terminal
  const sendInput = useCallback(
    async (data: string) => {
      if (!connectionId || !isConnected) return;

      try {
        await invoke("send_terminal_data", { connectionId, data });
      } catch (error) {
        console.error("Failed to send data to terminal:", error);
      }
    },
    [connectionId, isConnected],
  );

  // Handle key input - send everything to PTY
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      if (!isConnected) {
        return;
      }

      // Ignore modifier-only keys to prevent spam
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") {
        return;
      }

      // Allow global shortcuts to bubble up - don't prevent default for these combinations
      if (e.metaKey || e.ctrlKey) {
        // Check for global shortcuts that should bubble up
        if (e.key === "`" || e.key === "~") {
          // Terminal toggle - let it bubble up
          return;
        }
        if (e.key === "j" || e.key === "J") {
          // Terminal toggle (old shortcut) - let it bubble up
          return;
        }

        // Handle terminal-specific shortcuts
        if ((e.key === "t" || e.key === "T") && !e.shiftKey) {
          return; // Let terminal container handle new terminal
        }
        if ((e.key === "w" || e.key === "W") && !e.shiftKey) {
          return; // Let terminal container handle close terminal
        }

        // Other global shortcuts that should bubble up
        if (
          e.key === "`" ||
          e.key === "~" || // Common terminal shortcuts
          e.key === "k" ||
          e.key === "K" || // Command palette
          e.key === "p" ||
          e.key === "P" || // File search
          e.key === "f" ||
          e.key === "F" || // Find
          e.key === "," ||
          e.key === "<" || // Settings
          e.key === "n" ||
          e.key === "N" || // New window
          e.key === "q" ||
          e.key === "Q" || // Quit
          e.key === "r" ||
          e.key === "R" || // Refresh
          e.key === "s" ||
          e.key === "S" || // Save
          e.key === "o" ||
          e.key === "O" || // Open
          e.key === "z" ||
          e.key === "Z" || // Undo
          e.key === "y" ||
          e.key === "Y" || // Redo
          e.key === "x" ||
          e.key === "X" || // Cut
          e.key === "v" ||
          e.key === "V" || // Paste
          e.key === "a" ||
          e.key === "A" || // Select all
          e.key === "=" ||
          e.key === "+" || // Zoom in
          e.key === "-" ||
          e.key === "_" || // Zoom out
          e.key === "0" ||
          e.key === ")" || // Reset zoom
          (e.key >= "1" && e.key <= "9")
        ) {
          // Tab switching
          return;
        }
      }

      // Always prevent default and stop propagation for terminal input
      e.preventDefault();
      e.stopPropagation();

      let data = "";

      // Handle special keys first
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "c") {
          try {
            await invoke("send_terminal_ctrl_c", { connectionId });
          } catch (error) {
            console.error("Failed to send Ctrl+C:", error);
          }
          return;
        } else if (e.key === "d") {
          try {
            await invoke("send_terminal_ctrl_d", { connectionId });
          } catch (error) {
            console.error("Failed to send Ctrl+D:", error);
          }
          return;
        } else if (e.key.length === 1) {
          // Convert Ctrl+letter to control code
          const code = e.key.toLowerCase().charCodeAt(0) - 96;
          if (code > 0 && code < 27) {
            data = String.fromCharCode(code);
          }
        }
      } else {
        // Handle regular keys
        switch (e.key) {
          case "Enter":
            data = "\r";
            break;
          case "Backspace":
            data = "\x7f";
            break;
          case "Tab":
            data = "\t";
            break;
          case "ArrowUp":
            data = "\x1b[A";
            break;
          case "ArrowDown":
            data = "\x1b[B";
            break;
          case "ArrowRight":
            data = "\x1b[C";
            break;
          case "ArrowLeft":
            data = "\x1b[D";
            break;
          case "Home":
            data = "\x1b[H";
            break;
          case "End":
            data = "\x1b[F";
            break;
          case "PageUp":
            data = "\x1b[5~";
            break;
          case "PageDown":
            data = "\x1b[6~";
            break;
          case "Delete":
            data = "\x1b[3~";
            break;
          case "Escape":
            data = "\x1b";
            break;
          case " ":
            data = " ";
            break;
          default:
            // Handle all printable characters - be more specific
            if (e.key.length === 1 && e.key >= " " && e.key <= "~") {
              data = e.key;
            }
            break;
        }
      }

      if (data) {
        sendInput(data);
      }
    },
    [isConnected, connectionId, sendInput],
  );

  // Handle activity tracking
  useEffect(() => {
    if (isActive && onActivity) {
      onActivity(terminal.id);
    }
  }, [isActive, terminal.id, onActivity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (connectionId) {
        invoke("close_terminal_connection", { connectionId }).catch(console.error);
      }
    };
  }, [connectionId]);

  return (
    <div
      ref={sessionRef}
      className={`h-full ${isActive ? "block" : "hidden"}`}
      data-terminal-id={terminal.id}
    >
      <div className="flex h-full flex-col">
        {/* Terminal content */}
        <div
          ref={terminalRef}
          className={cn(
            "terminal-content relative flex-1 cursor-text overflow-auto",
            "bg-[#0d1117] p-3 font-mono text-[#c9d1d9] text-xs",
            "rounded-b-md",
          )}
          style={{
            fontFamily:
              "'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace",
            lineHeight: "1.5",
          }}
          onClick={() => {
            // Focus the hidden input when terminal is clicked
            if (inputRef.current) {
              inputRef.current.focus();
            }
          }}
        >
          {!isConnected ? (
            <div className="pt-4 text-center text-text-lighter">Connecting to terminal...</div>
          ) : screen.length > 100 ? (
            // Use virtualization for large outputs
            <VirtualizedTerminal
              screen={screen}
              cursorLine={cursorLine}
              cursorCol={cursorCol}
              containerRef={terminalRef}
            />
          ) : (
            // Use regular renderer for small outputs
            <TerminalRenderer screen={screen} cursorLine={cursorLine} cursorCol={cursorCol} />
          )}
        </div>
      </div>

      {/* Hidden textarea for capturing keyboard input */}
      <textarea
        ref={inputRef}
        id={`terminal-input-${terminal.id}`}
        className="pointer-events-none fixed resize-none opacity-0"
        style={{
          position: "fixed",
          left: "-9999px",
          top: "-9999px",
          width: "1px",
          height: "1px",
          opacity: 0,
          zIndex: -1,
          border: "none",
          outline: "none",
          background: "transparent",
        }}
        value=""
        onChange={() => {}}
        onKeyDown={handleKeyDown}
        onPaste={e => {
          e.preventDefault();
          const pasteData = e.clipboardData?.getData("text");
          if (pasteData && connectionId) {
            sendInput(pasteData);
          }
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        rows={1}
        cols={1}
      />
    </div>
  );
};

export default TerminalSession;
