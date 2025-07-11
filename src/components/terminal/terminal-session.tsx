import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Convert from "ansi-to-html";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal as TerminalType } from "../../types/terminal";

interface TerminalSessionProps {
  terminal: TerminalType;
  isActive: boolean;
  onDirectoryChange?: (terminalId: string, directory: string) => void;
  onActivity?: (terminalId: string) => void;
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
  type: "screenUpdate";
  screen: LineItem[][];
  cursor_line: number;
  cursor_col: number;
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
}: TerminalSessionProps) => {
  const sessionRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [screen, setScreen] = useState<LineItem[][]>([]);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [terminalSize, setTerminalSize] = useState({ rows: 24, cols: 80 });
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Create ANSI to HTML converter with minimal overrides
  // Let the shell's color configuration come through naturally
  const ansiConverter = useRef(
    new Convert({
      fg: "inherit", // Use shell's default foreground
      bg: "transparent", // Transparent background to use theme
      newline: false,
      escapeXML: true,
      // Don't override colors - let shell/terminal defaults come through
      colors: undefined,
    }),
  );

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

          // Listen for terminal events
          const unlisten = await listen(`terminal-event-${id}`, (event: any) => {
            const terminalEvent = event.payload as TerminalEvent;
            if (terminalEvent.type === "screenUpdate") {
              setScreen(terminalEvent.screen);
              setCursorLine(terminalEvent.cursor_line);
              setCursorCol(terminalEvent.cursor_col);
            }
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

  // Auto-focus hidden input when terminal becomes active
  useEffect(() => {
    if (isActive) {
      const hiddenInput = document.getElementById(`terminal-input-${terminal.id}`);
      if (hiddenInput) {
        hiddenInput.focus();
      }
    }
  }, [isActive, terminal.id]);

  // Auto-scroll to bottom when screen updates
  useEffect(() => {
    if (terminalRef.current && isActive && !isUserScrolling) {
      const terminal = terminalRef.current;
      // Use setTimeout to ensure the DOM has updated
      setTimeout(() => {
        terminal.scrollTop = terminal.scrollHeight;
      }, 0);
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

    terminal.addEventListener("scroll", handleScroll);
    return () => {
      terminal.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Handle terminal resize
  useEffect(() => {
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

    const resizeObserver = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [connectionId, terminalSize, calculateTerminalSize]);

  // Send input to terminal
  const sendInput = useCallback(
    async (data: string) => {
      if (connectionId && isConnected) {
        try {
          await invoke("send_terminal_data", { connectionId, data });
        } catch (error) {
          console.error("Failed to send data to terminal:", error);
        }
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
        if (e.key === "j" || e.key === "J") {
          // Terminal toggle - let it bubble up
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
        try {
          await sendInput(data);
        } catch (error) {
          console.error("Failed to send input:", error);
        }
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

  // Enhanced terminal line rendering with smart highlighting
  const renderTerminalLine = (line: LineItem[], lineIndex: number) => {
    if (!line || line.length === 0) {
      return (
        <div key={lineIndex} className="h-[14px]">
          &nbsp;
        </div>
      );
    }

    // Convert line to text for pattern detection
    const _lineText = line.map(item => item.lexeme || " ").join("");

    // Apply smart highlighting based on content patterns
    const enhancedLine = line.map((item, itemIndex) => {
      let className = "inline";
      const style: React.CSSProperties = {};

      if (item.is_bold) className += " font-bold";
      if (item.is_italic) className += " italic";
      if (item.is_underline) className += " underline";

      // Enhanced color handling
      if (item.foreground_color) {
        style.color = item.foreground_color || "#cccccc";
      }
      if (item.background_color) {
        style.backgroundColor = item.background_color || "transparent";
      }

      // Smart highlighting enhancements
      const lexeme = item.lexeme || " ";
      const enhancedLexeme = lexeme;

      // Only apply enhancements if there's no existing color
      if (!item.foreground_color) {
        // File extensions
        if (lexeme.match(/\.(js|ts|tsx|jsx)$/)) {
          style.color = "#f0db4f";
        } else if (lexeme.match(/\.(py)$/)) {
          style.color = "#3776ab";
        } else if (lexeme.match(/\.(rs)$/)) {
          style.color = "#dea584";
        } else if (lexeme.match(/\.(json)$/)) {
          style.color = "#cbcb41";
        } else if (lexeme.match(/\.(md)$/)) {
          style.color = "#083fa1";
        }

        // Directory indicators
        else if (lexeme.startsWith("drwx")) {
          style.color = "#58a6ff";
        }

        // Error patterns
        else if (lexeme.match(/(error|Error|ERROR|failed|Failed|FAILED|fatal|Fatal|FATAL)/)) {
          style.color = "#f85149";
          className += " font-bold";
        }

        // Warning patterns
        else if (lexeme.match(/(warning|Warning|WARNING|warn|Warn|WARN)/)) {
          style.color = "#f0883e";
          className += " font-bold";
        }

        // Success patterns
        else if (
          lexeme.match(/(success|Success|SUCCESS|done|Done|DONE|completed|Completed|COMPLETED)/)
        ) {
          style.color = "#3fb950";
          className += " font-bold";
        }

        // Git branch indicators
        else if (lexeme.match(/\(.*\)/)) {
          style.color = "#9a9a9a";
        }
      }

      return (
        <span
          key={itemIndex}
          className={className}
          style={style}
          dangerouslySetInnerHTML={{
            __html: ansiConverter.current.toHtml(enhancedLexeme),
          }}
        />
      );
    });

    return (
      <div key={lineIndex} className="h-[14px] whitespace-pre font-mono text-xs leading-[14px]">
        {enhancedLine}
      </div>
    );
  };

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
          className="relative flex-1 cursor-text overflow-hidden bg-primary-bg p-3 font-mono text-text text-xs"
          onClick={() => {
            // Focus the hidden input when terminal is clicked
            const hiddenInput = document.getElementById(`terminal-input-${terminal.id}`);
            if (hiddenInput) {
              hiddenInput.focus();
            }
          }}
        >
          {!isConnected ? (
            <div className="pt-4 text-center text-text-lighter">Connecting to terminal...</div>
          ) : (
            <div className="relative">
              {screen.map((line, index) => renderTerminalLine(line, index))}

              {/* Cursor */}
              <div
                className="absolute bg-text opacity-75"
                style={{
                  left: `${cursorCol * 7.2}px`,
                  top: `${cursorLine * 14}px`,
                  width: "7.2px",
                  height: "14px",
                  animation: "blink 1s infinite",
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Hidden textarea for capturing keyboard input */}
      <textarea
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
