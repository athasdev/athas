import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { SerializeAddon } from "xterm-addon-serialize";
import { Unicode11Addon } from "xterm-addon-unicode11";
import { WebLinksAddon } from "xterm-addon-web-links";
import { useEditorSettingsStore } from "../../stores/editor-settings-store";
import { useProjectStore } from "../../stores/project-store";
import { useTerminalStore } from "../../stores/terminal-store";
import { useThemeStore } from "../../stores/theme-store";
import { cn } from "../../utils/cn";
import { TerminalSearch } from "./terminal-search";
import "xterm/css/xterm.css";
import "./terminal.css";

interface XtermTerminalProps {
  sessionId: string;
  isActive: boolean;
  onReady?: () => void;
}

interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const XtermTerminal: React.FC<XtermTerminalProps> = ({ sessionId, isActive, onReady }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const isInitializingRef = useRef(false);

  const { updateSession, getSession } = useTerminalStore();
  const { currentTheme } = useThemeStore();
  const { fontSize: editorFontSize, fontFamily: editorFontFamily } = useEditorSettingsStore();
  const { rootFolderPath } = useProjectStore();
  const [fontSize, setFontSize] = useState(editorFontSize);

  const getTerminalTheme = useCallback((): TerminalTheme => {
    const computedStyle = getComputedStyle(document.documentElement);
    const getColor = (varName: string) => computedStyle.getPropertyValue(varName).trim();

    return {
      background: getColor("--color-primary-bg"),
      foreground: getColor("--color-text"),
      cursor: getColor("--color-accent"),
      cursorAccent: getColor("--color-background"),
      selectionBackground: `${getColor("--color-accent")}40`, // 40 = 25% opacity
      selectionForeground: getColor("--color-text"),
      black: getColor("--color-terminal-black") || "#000000",
      red: getColor("--color-terminal-red") || "#CD3131",
      green: getColor("--color-terminal-green") || "#0DBC79",
      yellow: getColor("--color-terminal-yellow") || "#E5E510",
      blue: getColor("--color-terminal-blue") || "#2472C8",
      magenta: getColor("--color-terminal-magenta") || "#BC3FBC",
      cyan: getColor("--color-terminal-cyan") || "#11A8CD",
      white: getColor("--color-terminal-white") || "#E5E5E5",
      brightBlack: getColor("--color-terminal-bright-black") || "#666666",
      brightRed: getColor("--color-terminal-bright-red") || "#F14C4C",
      brightGreen: getColor("--color-terminal-bright-green") || "#23D18B",
      brightYellow: getColor("--color-terminal-bright-yellow") || "#F5F543",
      brightBlue: getColor("--color-terminal-bright-blue") || "#3B8EEA",
      brightMagenta: getColor("--color-terminal-bright-magenta") || "#D670D6",
      brightCyan: getColor("--color-terminal-bright-cyan") || "#29B8DB",
      brightWhite: getColor("--color-terminal-bright-white") || "#FFFFFF",
    };
  }, []);

  const initializeTerminal = useCallback(async () => {
    console.log("Initializing terminal:", {
      sessionId,
      isInitialized,
      isInitializing: isInitializingRef.current,
      hasRef: !!terminalRef.current,
    });

    if (!terminalRef.current || isInitialized || isInitializingRef.current) {
      console.log("Skipping initialization - already initialized or in progress");
      return;
    }

    isInitializingRef.current = true;

    // Add a small delay to ensure DOM is ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (!terminalRef.current) {
      console.warn("Terminal ref is not available after delay");
      return;
    }

    console.log("Creating xterm instance...");
    try {
      const terminal = new Terminal({
        fontFamily: `${editorFontFamily}, "Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace`,
        fontSize: fontSize,
        fontWeight: "normal",
        fontWeightBold: "bold",
        lineHeight: 1.2,
        letterSpacing: 0,
        cursorBlink: true,
        cursorStyle: "bar",
        cursorWidth: 2,
        allowTransparency: false,
        allowProposedApi: true,
        theme: getTerminalTheme(),
        scrollback: 10000,
        tabStopWidth: 8,
        drawBoldTextInBrightColors: true,
        minimumContrastRatio: 4.5,
        convertEol: true,
        windowOptions: {},
      });

      // Initialize addons
      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      // WebLinksAddon with custom handler
      const webLinksAddon = new WebLinksAddon(async (_event: MouseEvent, uri: string) => {
        console.log("WebLinksAddon: Opening link", uri);

        try {
          // Show confirmation dialog
          const confirmed = await ask(`Do you want to open this link in your browser?\n\n${uri}`, {
            title: "Open External Link",
            kind: "warning",
            okLabel: "Open",
            cancelLabel: "Cancel",
          });

          if (confirmed) {
            await open(uri);
            console.log("Successfully opened link");
          } else {
            console.log("User cancelled opening link");
          }
        } catch (error) {
          console.error("Failed to open link:", error);
        }
      });
      const serializeAddon = new SerializeAddon();
      const unicode11Addon = new Unicode11Addon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(serializeAddon);
      terminal.loadAddon(unicode11Addon);

      // Open terminal in DOM
      terminal.open(terminalRef.current);

      // Load WebLinksAddon after terminal is open
      terminal.loadAddon(webLinksAddon);

      // Skip WebGL for now to avoid renderer issues
      console.log("Using default canvas renderer");

      // Activate unicode version 11
      terminal.unicode.activeVersion = "11";

      // Inject CSS for link styling
      const styleId = `terminal-link-style-${sessionId}`;
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        const accentColor = getComputedStyle(document.documentElement)
          .getPropertyValue("--color-accent")
          .trim();
        style.textContent = `
          #${terminalRef.current.id || `terminal-${sessionId}`} .xterm-screen a,
          #${terminalRef.current.id || `terminal-${sessionId}`} .xterm-link,
          #${terminalRef.current.id || `terminal-${sessionId}`} [style*="text-decoration"] {
            color: ${accentColor} !important;
            text-decoration: underline !important;
            cursor: pointer !important;
          }
          #${terminalRef.current.id || `terminal-${sessionId}`} .xterm-screen a:hover,
          #${terminalRef.current.id || `terminal-${sessionId}`} .xterm-link:hover {
            opacity: 0.8 !important;
          }
        `;
        document.head.appendChild(style);
      }

      // Fit terminal to container after a short delay
      setTimeout(() => {
        if (fitAddon && terminalRef.current) {
          fitAddon.fit();
        }
      }, 150);

      // Store refs
      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;
      serializeAddonRef.current = serializeAddon;

      // Create backend terminal connection
      try {
        // Check if we already have a connection
        const existingSession = getSession(sessionId);
        let connectionId = existingSession?.connectionId;

        if (!connectionId) {
          // Create new connection
          connectionId = await invoke<string>("create_xterm_terminal", {
            config: {
              working_directory: existingSession?.currentDirectory || rootFolderPath || undefined,
              shell: existingSession?.shell || undefined,
              rows: terminal.rows,
              cols: terminal.cols,
            },
          });

          // Store connection ID for this session
          updateSession(sessionId, { connectionId });
        } else {
          console.log("Reusing existing connection:", connectionId);
        }

        // Handle terminal input
        terminal.onData((data) => {
          invoke("terminal_write", { id: connectionId, data });
        });

        // Handle terminal resize
        terminal.onResize(({ cols, rows }) => {
          invoke("terminal_resize", { id: connectionId, rows, cols });
        });

        // Handle selection
        terminal.onSelectionChange(() => {
          const selection = terminal.getSelection();
          if (selection) {
            updateSession(sessionId, { selection });
          }
        });

        // Handle title changes
        terminal.onTitleChange((title) => {
          updateSession(sessionId, { title });
        });

        setIsInitialized(true);
        isInitializingRef.current = false;
        onReady?.();
      } catch (innerError) {
        console.error("Failed to create terminal connection:", innerError);
        terminal.writeln("\r\n\x1b[31mFailed to create terminal connection\x1b[0m");
        isInitializingRef.current = false;
      }
    } catch (error) {
      console.error("Failed to initialize terminal:", error);
      setIsInitialized(false);
      isInitializingRef.current = false;
    }
  }, [
    sessionId,
    isInitialized,
    getTerminalTheme,
    updateSession,
    onReady,
    fontSize,
    getSession,
    editorFontFamily,
    rootFolderPath,
  ]);

  // Handle terminal output
  useEffect(() => {
    if (!xtermRef.current || !isInitialized) return;

    const session = getSession(sessionId);
    if (!session?.connectionId) return;

    const unlisten = listen(`pty-output-${session.connectionId}`, (event) => {
      const data = event.payload as { data: string };
      xtermRef.current?.write(data.data);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [sessionId, isInitialized, getSession]);

  // Handle theme changes
  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = getTerminalTheme();
  }, [currentTheme, getTerminalTheme]);

  // Handle font changes from editor settings
  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.fontFamily = `${editorFontFamily}, "Fira Code", "Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace`;
    xtermRef.current.options.fontSize = fontSize;
    fitAddonRef.current?.fit();
  }, [editorFontFamily, fontSize]);

  // Initialize terminal
  useEffect(() => {
    let mounted = true;
    let initTimer: NodeJS.Timeout;

    const init = async () => {
      if (!mounted) return;

      // Only initialize after a short delay to ensure theme is loaded
      initTimer = setTimeout(() => {
        if (mounted && !isInitialized) {
          initializeTerminal();
        }
      }, 200);
    };

    init();

    return () => {
      mounted = false;
      clearTimeout(initTimer);

      // Clean up injected styles
      const styleId = `terminal-link-style-${sessionId}`;
      const style = document.getElementById(styleId);
      if (style) {
        style.remove();
      }

      if (xtermRef.current) {
        // Close backend connection
        const session = getSession(sessionId);
        if (session?.connectionId) {
          invoke("close_xterm_terminal", { id: session.connectionId });
        }

        xtermRef.current.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
        serializeAddonRef.current = null;
        setIsInitialized(false);
      }
    };
  }, []); // Remove dependencies to prevent re-initialization

  // Handle resize
  useEffect(() => {
    if (!fitAddonRef.current || !terminalRef.current || !isInitialized) return;

    const resizeObserver = new ResizeObserver(() => {
      // Debounce resize to avoid excessive calls
      requestAnimationFrame(() => {
        if (fitAddonRef.current && xtermRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch (e) {
            console.warn("Failed to fit terminal:", e);
          }
        }
      });
    });

    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isInitialized]);

  // Handle focus
  useEffect(() => {
    if (isActive && xtermRef.current) {
      xtermRef.current.focus();
    }
  }, [isActive]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    const newSize = Math.min(fontSize + 2, 32);
    setFontSize(newSize);
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = newSize;
      fitAddonRef.current?.fit();
    }
  }, [fontSize]);

  const handleZoomOut = useCallback(() => {
    const newSize = Math.max(fontSize - 2, 8);
    setFontSize(newSize);
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = newSize;
      fitAddonRef.current?.fit();
    }
  }, [fontSize]);

  const handleZoomReset = useCallback(() => {
    setFontSize(editorFontSize);
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = editorFontSize;
      fitAddonRef.current?.fit();
    }
  }, [editorFontSize]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if the event is from the terminal element or its children
      const isTerminalFocused = terminalRef.current?.contains(e.target as Node);

      // Ctrl+F or Cmd+F for search - only when terminal is focused or already searching
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && (isTerminalFocused || isSearchVisible)) {
        e.preventDefault();
        e.stopPropagation();
        setIsSearchVisible(true);
      }
      // Escape to close search
      if (e.key === "Escape" && isSearchVisible) {
        e.preventDefault();
        setIsSearchVisible(false);
        xtermRef.current?.focus();
      }
      // Ctrl/Cmd + Plus for zoom in
      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=") && isTerminalFocused) {
        e.preventDefault();
        handleZoomIn();
      }
      // Ctrl/Cmd + Minus for zoom out
      if ((e.ctrlKey || e.metaKey) && e.key === "-" && isTerminalFocused) {
        e.preventDefault();
        handleZoomOut();
      }
      // Ctrl/Cmd + 0 for reset zoom
      if ((e.ctrlKey || e.metaKey) && e.key === "0" && isTerminalFocused) {
        e.preventDefault();
        handleZoomReset();
      }
    };

    // Use capture phase to ensure we get the event before other handlers
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isActive, isSearchVisible, handleZoomIn, handleZoomOut, handleZoomReset]);

  // Search handlers
  const handleSearch = useCallback((term: string) => {
    searchAddonRef.current?.findNext(term);
  }, []);

  const handleSearchNext = useCallback((term: string) => {
    searchAddonRef.current?.findNext(term);
  }, []);

  const handleSearchPrevious = useCallback((term: string) => {
    searchAddonRef.current?.findPrevious(term);
  }, []);

  const handleSearchClose = useCallback(() => {
    setIsSearchVisible(false);
    xtermRef.current?.focus();
  }, []);

  // Public methods via imperative handle
  React.useImperativeHandle(
    getSession(sessionId)?.ref,
    () => ({
      terminal: xtermRef.current,
      searchAddon: searchAddonRef.current,
      focus: () => xtermRef.current?.focus(),
      blur: () => xtermRef.current?.blur(),
      clear: () => xtermRef.current?.clear(),
      selectAll: () => xtermRef.current?.selectAll(),
      clearSelection: () => xtermRef.current?.clearSelection(),
      getSelection: () => xtermRef.current?.getSelection() || "",
      paste: (text: string) => xtermRef.current?.paste(text),
      scrollToTop: () => xtermRef.current?.scrollToTop(),
      scrollToBottom: () => xtermRef.current?.scrollToBottom(),
      findNext: (term: string) => searchAddonRef.current?.findNext(term),
      findPrevious: (term: string) => searchAddonRef.current?.findPrevious(term),
      serialize: () => (xtermRef.current ? serializeAddonRef.current?.serialize() : ""),
      resize: () => fitAddonRef.current?.fit(),
    }),
    [sessionId, isInitialized],
  );

  return (
    <div className="relative h-full w-full bg-primary-bg">
      <TerminalSearch
        isVisible={isSearchVisible}
        onSearch={handleSearch}
        onNext={handleSearchNext}
        onPrevious={handleSearchPrevious}
        onClose={handleSearchClose}
      />
      <div
        ref={terminalRef}
        id={`terminal-${sessionId}`}
        className={cn("xterm-container", "h-full w-full", "text-text", !isActive && "opacity-60")}
      />
    </div>
  );
};
