import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";

import { useSettingsStore } from "@/features/settings/store";
import { useProjectStore } from "@/stores/project-store";
import { useThemeStore } from "@/stores/theme-store";
import {
  createTerminalAddons,
  injectLinkStyles,
  loadWebLinksAddon,
  removeLinkStyles,
  type TerminalAddons,
} from "../hooks/use-terminal-addons";
import { useTerminalTheme } from "../hooks/use-terminal-theme";
import { useTerminalStore } from "../stores/terminal-store";
import { parseOSC7 } from "../utils/osc-parser";
import { TerminalSearch } from "./terminal-search";
import "@xterm/xterm/css/xterm.css";
import "../styles/terminal.css";

interface XtermTerminalProps {
  sessionId: string;
  isActive: boolean;
  onReady?: () => void;
  onTerminalRef?: (ref: { focus: () => void; terminal: Terminal }) => void;
  onTerminalExit?: (sessionId: string) => void;
}

export const XtermTerminal: React.FC<XtermTerminalProps> = ({
  sessionId,
  isActive,
  onReady,
  onTerminalRef,
  onTerminalExit,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const addonsRef = useRef<TerminalAddons | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState({ current: 0, total: 0 });
  const isInitializingRef = useRef(false);
  const currentConnectionIdRef = useRef<string | null>(null);
  const onTerminalExitRef = useRef(onTerminalExit);
  const currentInputLineRef = useRef("");

  useEffect(() => {
    onTerminalExitRef.current = onTerminalExit;
  }, [onTerminalExit]);

  const { updateSession, getSession } = useTerminalStore();
  const { currentTheme } = useThemeStore();

  const {
    terminalFontFamily,
    terminalFontSize,
    terminalLineHeight,
    terminalLetterSpacing,
    terminalCursorStyle,
    terminalCursorBlink,
  } = useSettingsStore((state) => state.settings);
  const { rootFolderPath } = useProjectStore();
  const { getTerminalTheme } = useTerminalTheme();

  const initializeTerminal = useCallback(async () => {
    if (!terminalRef.current || isInitialized || isInitializingRef.current) return;

    isInitializingRef.current = true;

    // Wait for font to load before initializing terminal
    try {
      await document.fonts.load(`${terminalFontSize}px "${terminalFontFamily}"`);
    } catch {
      // Font load failed, continue with fallback
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    if (!terminalRef.current) {
      isInitializingRef.current = false;
      return;
    }

    try {
      // Quote font names with spaces for CSS
      const fontFamily = terminalFontFamily.includes(" ")
        ? `"${terminalFontFamily}", monospace`
        : `${terminalFontFamily}, monospace`;

      const terminal = new Terminal({
        fontFamily,
        fontSize: terminalFontSize,
        lineHeight: terminalLineHeight,
        letterSpacing: terminalLetterSpacing,
        cursorBlink: terminalCursorBlink,
        cursorStyle: terminalCursorStyle,
        cursorWidth: 2,
        allowProposedApi: true,
        theme: getTerminalTheme(),
        scrollback: 10000,
        convertEol: true,
      });

      // Skip WebGL for fonts with spaces (like Nerd Fonts) - they have issues with WebGL's texture atlas
      const skipWebGL = terminalFontFamily.includes(" ");
      const addons = createTerminalAddons(terminal, { skipWebGL });
      terminal.open(terminalRef.current);

      terminal.attachCustomKeyEventHandler((e) => {
        if (e.ctrlKey && !e.metaKey) return true;
        if (e.metaKey) return false;
        return true;
      });

      loadWebLinksAddon(terminal);
      terminal.unicode.activeVersion = "11";
      injectLinkStyles(sessionId, terminalRef.current.id || `terminal-${sessionId}`);

      setTimeout(() => addons.fitAddon.fit(), 150);

      xtermRef.current = terminal;
      addonsRef.current = addons;

      // Create backend connection
      const existingSession = getSession(sessionId);
      if (existingSession?.connectionId) {
        try {
          await invoke("close_terminal", { id: existingSession.connectionId });
        } catch {}
      }

      const connectionId = await invoke<string>("create_terminal", {
        config: {
          working_directory: existingSession?.currentDirectory || rootFolderPath || undefined,
          shell: existingSession?.shell || undefined,
          rows: terminal.rows,
          cols: terminal.cols,
        },
      });

      updateSession(sessionId, { connectionId });
      currentConnectionIdRef.current = connectionId;

      // Handle input with exit detection
      terminal.onData((data) => {
        const currentId = currentConnectionIdRef.current || connectionId;
        const hasNewline = data.includes("\n") || data.includes("\r");

        if (hasNewline) {
          currentInputLineRef.current += data;
          if (/^\s*exit\s*$/i.test(currentInputLineRef.current.trim())) {
            currentInputLineRef.current = "";
            invoke("terminal_write", { id: currentId, data }).catch(() => {});
            setTimeout(() => {
              onTerminalExitRef.current?.(sessionId);
              invoke("close_terminal", { id: currentId }).catch(() => {});
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

        invoke("terminal_write", { id: currentId, data }).catch(() => {});
      });

      // Handle keyboard shortcuts
      terminal.onKey(({ domEvent: e }) => {
        const currentId = currentConnectionIdRef.current || connectionId;
        const shortcuts: Record<string, string> = {
          "meta+Backspace": "\u0015",
          "ctrl+u": "\u0015",
          "meta+k": "\u000c",
          "alt+Backspace": "\u0017",
          "meta+a": "\u0001",
          "meta+e": "\u0005",
        };

        const key = `${e.metaKey ? "meta+" : ""}${e.ctrlKey ? "ctrl+" : ""}${e.altKey ? "alt+" : ""}${e.key}`;
        if (shortcuts[key]) {
          e.preventDefault();
          invoke("terminal_write", { id: currentId, data: shortcuts[key] }).catch(() => {});
          return;
        }

        if (e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          invoke("terminal_write", {
            id: currentId,
            data: e.key === "ArrowLeft" ? "\u0001" : "\u0005",
          }).catch(() => {});
        }

        if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          invoke("terminal_write", {
            id: currentId,
            data: e.key === "ArrowLeft" ? "\u001bb" : "\u001bf",
          }).catch(() => {});
        }
      });

      terminal.onResize(({ cols, rows }) => {
        const currentId = currentConnectionIdRef.current || connectionId;
        invoke("terminal_resize", { id: currentId, rows, cols }).catch(() => {});
      });

      terminal.onSelectionChange(() => {
        const selection = terminal.getSelection();
        if (selection) updateSession(sessionId, { selection });
      });

      terminal.onTitleChange((title) => updateSession(sessionId, { title }));

      setIsInitialized(true);
      isInitializingRef.current = false;

      // Emit terminal-ready event for pending commands
      window.dispatchEvent(
        new CustomEvent("terminal-ready", {
          detail: { terminalId: sessionId, connectionId },
        }),
      );

      onTerminalRef?.({ focus: () => terminal.focus(), terminal });
      onReady?.();
    } catch (error) {
      console.error("Failed to initialize terminal:", error);
      isInitializingRef.current = false;
    }
  }, [
    sessionId,
    isInitialized,
    getTerminalTheme,
    updateSession,
    onReady,

    getSession,
    getSession,
    terminalFontFamily,
    terminalFontSize,
    terminalLineHeight,
    terminalLetterSpacing,
    terminalCursorStyle,
    terminalCursorBlink,
    rootFolderPath,
    onTerminalRef,
  ]);

  const session = getSession(sessionId);
  const connectionId = session?.connectionId;

  // Handle terminal output
  useEffect(() => {
    if (!xtermRef.current || !isInitialized || !connectionId) return;

    currentConnectionIdRef.current = connectionId;

    const unlistenOutput = listen(`pty-output-${connectionId}`, (event) => {
      const data = event.payload as { data: string };
      if (xtermRef.current) {
        xtermRef.current.write(data.data);
        const newDirectory = parseOSC7(data.data);
        if (newDirectory) updateSession(sessionId, { currentDirectory: newDirectory });
      }
    });

    const unlistenError = listen(`pty-error-${connectionId}`, (event) => {
      const error = event.payload as { error: string };
      xtermRef.current?.writeln(`\r\n\x1b[31mError: ${error.error}\x1b[0m`);
    });

    const unlistenClosed = listen(`pty-closed-${connectionId}`, async () => {
      try {
        await invoke("close_terminal", { id: connectionId });
      } catch {}
      onTerminalExitRef.current?.(sessionId);
    });

    const unlistenThemeChange = themeRegistry.onThemeChange(() => {
      if (xtermRef.current) xtermRef.current.options.theme = getTerminalTheme();
    });

    return () => {
      unlistenOutput.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenClosed.then((fn) => fn());
      unlistenThemeChange();
    };
  }, [sessionId, isInitialized, connectionId, updateSession, getTerminalTheme]);

  // Handle theme changes
  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = getTerminalTheme();
    setTimeout(() => {
      xtermRef.current?.refresh(0, xtermRef.current.rows - 1);
      addonsRef.current?.fitAddon.fit();
    }, 10);
  }, [currentTheme, getTerminalTheme]);

  // Handle font changes
  useEffect(() => {
    if (!xtermRef.current || !addonsRef.current) return;

    const applyFontSettings = () => {
      if (!xtermRef.current || !addonsRef.current) return;

      // Dispose WebGL addon - the canvas renderer handles font changes more reliably,
      // especially for Nerd Fonts which have issues with WebGL's texture atlas
      addonsRef.current.webglAddon?.dispose();

      // Set font options (quote font names with spaces for CSS)
      const fontFamily = terminalFontFamily.includes(" ")
        ? `"${terminalFontFamily}", monospace`
        : `${terminalFontFamily}, monospace`;

      xtermRef.current.options.fontFamily = fontFamily;
      xtermRef.current.options.fontSize = terminalFontSize;
      xtermRef.current.options.lineHeight = terminalLineHeight;
      xtermRef.current.options.letterSpacing = terminalLetterSpacing;
      xtermRef.current.options.cursorBlink = terminalCursorBlink;
      xtermRef.current.options.cursorStyle = terminalCursorStyle;

      addonsRef.current.fitAddon.fit();
      xtermRef.current.refresh(0, xtermRef.current.rows - 1);
    };

    // Wait for font to load before applying
    document.fonts
      .load(`${terminalFontSize}px "${terminalFontFamily}"`)
      .then(() => applyFontSettings())
      .catch(() => applyFontSettings());
  }, [
    terminalFontFamily,
    terminalFontSize,
    terminalLineHeight,
    terminalLetterSpacing,
    terminalCursorBlink,
    terminalCursorStyle,
  ]);

  // Initialize terminal
  useEffect(() => {
    let mounted = true;
    const initTimer = setTimeout(() => {
      if (mounted && !isInitialized && !isInitializingRef.current) {
        initializeTerminal();
      }
    }, 200);

    return () => {
      mounted = false;
      clearTimeout(initTimer);
      removeLinkStyles(sessionId);
    };
  }, [sessionId, initializeTerminal, isInitialized]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (xtermRef.current) {
        const session = getSession(sessionId);
        if (session?.connectionId) {
          invoke("close_terminal", { id: session.connectionId });
        }
        xtermRef.current.dispose();
        xtermRef.current = null;
        addonsRef.current = null;
      }
    };
  }, [sessionId, getSession]);

  // Handle resize
  useEffect(() => {
    if (!addonsRef.current || !terminalRef.current || !isInitialized) return;

    let rafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (addonsRef.current && terminalRef.current) {
          const rect = terminalRef.current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            addonsRef.current.fitAddon.fit();
          }
        }
      });
    });

    resizeObserver.observe(terminalRef.current);
    setTimeout(() => addonsRef.current?.fitAddon.fit(), 100);

    return () => {
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isInitialized]);

  // Handle focus
  useEffect(() => {
    if (isActive && xtermRef.current && isInitialized) {
      requestAnimationFrame(() => xtermRef.current?.focus());
    }
  }, [isActive, isInitialized]);

  // Zoom handlers
  const handleZoom = useCallback(
    (delta: number) => {
      const newSize = Math.min(Math.max(terminalFontSize + delta, 8), 32);
      useSettingsStore.getState().updateSetting("terminalFontSize", newSize);
      if (xtermRef.current) {
        xtermRef.current.options.fontSize = newSize;
        addonsRef.current?.fitAddon.fit();
      }
    },
    [terminalFontSize],
  );

  const handleZoomReset = useCallback(() => {
    useSettingsStore.getState().updateSetting("terminalFontSize", 14);
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = 14;
      addonsRef.current?.fitAddon.fit();
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isTerminalFocused = terminalRef.current?.contains(e.target as Node);

      if ((e.ctrlKey || e.metaKey) && e.key === "f" && (isTerminalFocused || isSearchVisible)) {
        e.preventDefault();
        e.stopPropagation();
        setIsSearchVisible(true);
      }

      if (e.key === "Escape" && isSearchVisible) {
        e.preventDefault();
        setIsSearchVisible(false);
        xtermRef.current?.focus();
      }

      if (isTerminalFocused && (e.ctrlKey || e.metaKey)) {
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          handleZoom(2);
        } else if (e.key === "-") {
          e.preventDefault();
          handleZoom(-2);
        } else if (e.key === "0") {
          e.preventDefault();
          handleZoomReset();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isActive, isSearchVisible, handleZoom, handleZoomReset]);

  // Search handlers
  const handleSearch = useCallback((term: string) => {
    if (!term || !addonsRef.current) {
      setSearchResults({ current: 0, total: 0 });
      return;
    }
    const found = addonsRef.current.searchAddon.findNext(term);
    setSearchResults((prev) =>
      found ? { ...prev, current: prev.current + 1 } : { current: 0, total: 0 },
    );
  }, []);

  const handleSearchNext = useCallback((term: string) => {
    if (!term || !addonsRef.current) return;
    if (addonsRef.current.searchAddon.findNext(term)) {
      setSearchResults((prev) => ({ ...prev, current: prev.current + 1 }));
    }
  }, []);

  const handleSearchPrevious = useCallback((term: string) => {
    if (!term || !addonsRef.current) return;
    if (addonsRef.current.searchAddon.findPrevious(term)) {
      setSearchResults((prev) => ({ ...prev, current: Math.max(1, prev.current - 1) }));
    }
  }, []);

  const handleSearchClose = useCallback(() => {
    setIsSearchVisible(false);
    setSearchResults({ current: 0, total: 0 });
    xtermRef.current?.focus();
  }, []);

  // Imperative handle
  React.useImperativeHandle(
    getSession(sessionId)?.ref,
    () => ({
      terminal: xtermRef.current,
      searchAddon: addonsRef.current?.searchAddon,
      focus: () => xtermRef.current?.focus(),
      blur: () => xtermRef.current?.blur(),
      clear: () => xtermRef.current?.clear(),
      selectAll: () => xtermRef.current?.selectAll(),
      clearSelection: () => xtermRef.current?.clearSelection(),
      getSelection: () => xtermRef.current?.getSelection() || "",
      paste: (text: string) => xtermRef.current?.paste(text),
      scrollToTop: () => xtermRef.current?.scrollToTop(),
      scrollToBottom: () => xtermRef.current?.scrollToBottom(),
      findNext: (term: string) => addonsRef.current?.searchAddon.findNext(term),
      findPrevious: (term: string) => addonsRef.current?.searchAddon.findPrevious(term),
      serialize: () => (xtermRef.current ? addonsRef.current?.serializeAddon.serialize() : ""),
      resize: () => addonsRef.current?.fitAddon.fit(),
    }),
    [sessionId, isInitialized, getSession],
  );

  return (
    <div className="relative h-full w-full bg-primary-bg">
      <TerminalSearch
        isVisible={isSearchVisible}
        onSearch={handleSearch}
        onNext={handleSearchNext}
        onPrevious={handleSearchPrevious}
        onClose={handleSearchClose}
        currentMatch={searchResults.current}
        totalMatches={searchResults.total}
      />
      <div
        ref={terminalRef}
        id={`terminal-${sessionId}`}
        className={`xterm-container h-full w-full text-text ${!isActive && "opacity-60"}`}
      />
    </div>
  );
};
