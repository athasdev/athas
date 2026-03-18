import { invoke } from "@tauri-apps/api/core";
import type { ISearchOptions } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useProjectStore } from "@/features/window/stores/project-store";
import {
  createTerminalAddons,
  injectLinkStyles,
  loadWebLinksAddon,
  removeLinkStyles,
  type TerminalAddons,
} from "../hooks/use-terminal-addons";
import { useTerminalConnection } from "../hooks/use-terminal-connection";
import { useTerminalTheme } from "../hooks/use-terminal-theme";
import { useTerminalStore } from "../stores/terminal-store";
import { resolveTerminalFont } from "../utils/resolve-font";
import { TerminalSearch, type TerminalSearchOptions } from "./terminal-search";
import "@xterm/xterm/css/xterm.css";
import "../styles/terminal.css";

interface XtermTerminalProps {
  sessionId: string;
  isActive: boolean;
  isVisible?: boolean;
  onReady?: () => void;
  onTerminalRef?: (ref: { focus: () => void; showSearch: () => void; terminal: Terminal }) => void;
  onTerminalExit?: (sessionId: string) => void;
  initialCommand?: string;
  workingDirectory?: string;
}

export const XtermTerminal: React.FC<XtermTerminalProps> = ({
  sessionId,
  isActive,
  isVisible = true,
  onReady,
  onTerminalRef,
  onTerminalExit,
  initialCommand,
  workingDirectory,
}) => {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const addonsRef = useRef<TerminalAddons | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState({ current: 0, total: 0 });
  const isInitializingRef = useRef(false);

  const { updateSession, getSession } = useTerminalStore();
  const session = getSession(sessionId);
  const connectionId = session?.connectionId;

  const {
    theme: terminalThemeId,
    terminalFontFamily,
    terminalFontSize,
    terminalLineHeight,
    terminalLetterSpacing,
    terminalScrollback,
    terminalCursorStyle,
    terminalCursorBlink,
    terminalCursorWidth,
  } = useSettingsStore((state) => state.settings);
  const { rootFolderPath } = useProjectStore();
  const { getTerminalTheme } = useTerminalTheme();

  const fitTerminal = useCallback((attempts = 1) => {
    let attempt = 0;
    let rafId: number | null = null;

    const runFit = () => {
      const container = terminalContainerRef.current;
      const addons = addonsRef.current;
      if (!container || !addons) return;

      const rect = container.getBoundingClientRect();
      const isContainerVisible = container.offsetParent !== null;
      if (rect.width <= 0 || rect.height <= 0 || !isContainerVisible) {
        if (attempt < attempts - 1) {
          attempt += 1;
          rafId = requestAnimationFrame(runFit);
        }
        return;
      }

      addons.fitAddon.fit();

      if (attempt < attempts - 1) {
        attempt += 1;
        rafId = requestAnimationFrame(runFit);
      }
    };

    rafId = requestAnimationFrame(runFit);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  const { currentConnectionIdRef, writeBuffered } = useTerminalConnection({
    connectionId,
    getTerminalTheme,
    initialCommand,
    isInitialized,
    onTerminalExit,
    sessionId,
    terminal: xtermRef.current,
    updateSession,
  });

  const initializeTerminal = useCallback(async () => {
    const container = terminalContainerRef.current;
    if (!container || isInitialized || isInitializingRef.current) return;

    const rect = container.getBoundingClientRect();
    const isContainerVisible = container.offsetParent !== null;
    if (rect.width <= 0 || rect.height <= 0 || !isContainerVisible) return;

    isInitializingRef.current = true;
    const resolved = await resolveTerminalFont(terminalFontFamily, terminalFontSize);
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (!terminalContainerRef.current) {
      isInitializingRef.current = false;
      return;
    }

    try {
      const terminal = new Terminal({
        fontFamily: resolved.fontFamily,
        fontSize: terminalFontSize,
        lineHeight: terminalLineHeight,
        letterSpacing: terminalLetterSpacing,
        cursorBlink: terminalCursorBlink,
        cursorStyle: terminalCursorStyle,
        cursorWidth: terminalCursorWidth,
        allowProposedApi: true,
        theme: getTerminalTheme(),
        scrollback: terminalScrollback,
        convertEol: true,
      });

      const addons = createTerminalAddons(terminal, {
        skipWebGL: resolved.skipWebGL,
      });

      terminal.open(terminalContainerRef.current);
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.ctrlKey && !event.metaKey) return true;
        if (
          event.metaKey &&
          ["Backspace", "k", "a", "e", "f", "ArrowLeft", "ArrowRight"].includes(event.key)
        ) {
          return true;
        }
        return !event.metaKey;
      });

      if (terminal.textarea) {
        terminal.textarea.addEventListener("beforeinput", (event) => {
          if (event.inputType === "insertReplacementText" || event.inputType === "insertFromDrop") {
            const text = event.dataTransfer?.getData("text/plain") ?? event.data;
            if (!text || !currentConnectionIdRef.current) return;

            event.preventDefault();
            writeBuffered(text);
          }
        });
      }

      loadWebLinksAddon(terminal);
      terminal.unicode.activeVersion = "11";
      injectLinkStyles(sessionId, terminalContainerRef.current.id || `terminal-${sessionId}`);

      xtermRef.current = terminal;
      addonsRef.current = addons;
      fitTerminal(12);

      const existingSession = getSession(sessionId);
      if (existingSession?.connectionId) {
        try {
          await invoke("close_terminal", { id: existingSession.connectionId });
        } catch {}
      }

      const newConnectionId = await invoke<string>("create_terminal", {
        config: {
          working_directory:
            workingDirectory || existingSession?.currentDirectory || rootFolderPath || undefined,
          shell: existingSession?.shell || undefined,
          rows: terminal.rows,
          cols: terminal.cols,
        },
      });

      updateSession(sessionId, { connectionId: newConnectionId });
      setIsInitialized(true);
      isInitializingRef.current = false;

      window.dispatchEvent(
        new CustomEvent("terminal-ready", {
          detail: { terminalId: sessionId, connectionId: newConnectionId },
        }),
      );

      onTerminalRef?.({
        focus: () => terminal.focus(),
        showSearch: () => setIsSearchVisible(true),
        terminal,
      });
      onReady?.();
    } catch (error) {
      console.error("Failed to initialize terminal:", error);
      isInitializingRef.current = false;
    }
  }, [
    currentConnectionIdRef,
    fitTerminal,
    getSession,
    getTerminalTheme,
    isInitialized,
    onReady,
    onTerminalRef,
    rootFolderPath,
    sessionId,
    terminalCursorBlink,
    terminalCursorStyle,
    terminalCursorWidth,
    terminalFontFamily,
    terminalFontSize,
    terminalLetterSpacing,
    terminalLineHeight,
    terminalScrollback,
    updateSession,
    workingDirectory,
    writeBuffered,
  ]);

  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = getTerminalTheme();
    const timer = setTimeout(() => {
      xtermRef.current?.refresh(0, xtermRef.current.rows - 1);
      fitTerminal(4);
    }, 10);
    return () => clearTimeout(timer);
  }, [terminalThemeId, getTerminalTheme, fitTerminal]);

  useEffect(() => {
    if (!xtermRef.current || !addonsRef.current) return;

    let cancelled = false;

    const applyFontChange = async () => {
      const resolved = await resolveTerminalFont(terminalFontFamily, terminalFontSize);
      if (cancelled || !xtermRef.current || !addonsRef.current) return;

      if (resolved.skipWebGL) {
        addonsRef.current.webglAddon?.dispose();
      }

      xtermRef.current.options.fontFamily = resolved.fontFamily;
      xtermRef.current.options.fontSize = terminalFontSize;
      xtermRef.current.options.lineHeight = terminalLineHeight;
      xtermRef.current.options.letterSpacing = terminalLetterSpacing;
      xtermRef.current.options.scrollback = terminalScrollback;
      xtermRef.current.options.cursorBlink = terminalCursorBlink;
      xtermRef.current.options.cursorStyle = terminalCursorStyle;
      xtermRef.current.options.cursorWidth = terminalCursorWidth;

      fitTerminal(4);
      xtermRef.current.refresh(0, xtermRef.current.rows - 1);
    };

    void applyFontChange();

    return () => {
      cancelled = true;
    };
  }, [
    terminalFontFamily,
    terminalFontSize,
    terminalLineHeight,
    terminalLetterSpacing,
    terminalScrollback,
    terminalCursorBlink,
    terminalCursorStyle,
    terminalCursorWidth,
    fitTerminal,
  ]);

  useEffect(() => {
    if (!isVisible) return;

    let mounted = true;
    const initTimer = setTimeout(() => {
      if (mounted && !isInitialized && !isInitializingRef.current) {
        void initializeTerminal();
      }
    }, 200);

    return () => {
      mounted = false;
      clearTimeout(initTimer);
      removeLinkStyles(sessionId);
    };
  }, [initializeTerminal, isInitialized, isVisible, sessionId]);

  useEffect(() => {
    if (isInitialized || !isVisible || !terminalContainerRef.current) return;

    let rafId: number | null = null;
    const container = terminalContainerRef.current;

    const attemptInitialize = () => {
      if (isInitialized || isInitializingRef.current) return;

      const rect = container.getBoundingClientRect();
      const isContainerVisible = container.offsetParent !== null;
      if (rect.width <= 0 || rect.height <= 0 || !isContainerVisible) {
        rafId = requestAnimationFrame(attemptInitialize);
        return;
      }

      void initializeTerminal();
    };

    rafId = requestAnimationFrame(attemptInitialize);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [initializeTerminal, isInitialized, isVisible]);

  useEffect(() => {
    return () => {
      const activeSession = getSession(sessionId);
      if (xtermRef.current) {
        if (activeSession?.connectionId) {
          void invoke("close_terminal", { id: activeSession.connectionId });
        }
        xtermRef.current.dispose();
        xtermRef.current = null;
        addonsRef.current = null;
      }
    };
  }, [getSession, sessionId]);

  useEffect(() => {
    if (!addonsRef.current || !terminalContainerRef.current || !isInitialized) return;

    let rafId: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const container = terminalContainerRef.current;
        if (!addonsRef.current || !container) return;

        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          fitTerminal(3);
        }
      });
    });

    resizeObserver.observe(terminalContainerRef.current);
    const cleanupFit = fitTerminal(12);

    return () => {
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      cleanupFit?.();
    };
  }, [fitTerminal, isInitialized]);

  useEffect(() => {
    if (isActive && isVisible && xtermRef.current && isInitialized) {
      const cleanupFit = fitTerminal(12);
      requestAnimationFrame(() => xtermRef.current?.focus());
      return () => cleanupFit?.();
    }
  }, [isActive, isInitialized, isVisible, fitTerminal]);

  useEffect(() => {
    if (!isInitialized || !addonsRef.current) return;

    const disposable = addonsRef.current.searchAddon.onDidChangeResults(
      ({ resultIndex, resultCount }) => {
        setSearchResults({
          current: resultCount > 0 && resultIndex >= 0 ? resultIndex + 1 : 0,
          total: resultCount,
        });
      },
    );

    return () => disposable.dispose();
  }, [isInitialized]);

  const handleZoom = useCallback(
    (delta: number) => {
      const newSize = Math.min(Math.max(terminalFontSize + delta, 8), 32);
      useSettingsStore.getState().updateSetting("terminalFontSize", newSize);
      if (xtermRef.current) {
        xtermRef.current.options.fontSize = newSize;
        fitTerminal(4);
      }
    },
    [fitTerminal, terminalFontSize],
  );

  const handleZoomReset = useCallback(() => {
    useSettingsStore.getState().updateSetting("terminalFontSize", 14);
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = 14;
      fitTerminal(4);
    }
  }, [fitTerminal]);

  const getSearchOptions = useCallback((options: TerminalSearchOptions): ISearchOptions => {
    const rootStyles = getComputedStyle(document.documentElement);
    const selected = rootStyles.getPropertyValue("--color-selected").trim() || "#3b82f6";
    const accent = rootStyles.getPropertyValue("--color-accent").trim() || "#60a5fa";
    const border = rootStyles.getPropertyValue("--color-border").trim() || "#4b5563";

    return {
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      regex: options.regex,
      decorations: {
        matchBackground: selected,
        matchBorder: border,
        matchOverviewRuler: selected,
        activeMatchBackground: accent,
        activeMatchBorder: border,
        activeMatchColorOverviewRuler: accent,
      },
    };
  }, []);

  const clearSearch = useCallback(() => {
    addonsRef.current?.searchAddon.clearDecorations();
    xtermRef.current?.clearSelection();
    setSearchResults({ current: 0, total: 0 });
  }, []);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const isTerminalFocused =
        terminalContainerRef.current?.contains(event.target as Node) ||
        terminalContainerRef.current?.contains(document.activeElement);
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === "f" && (isTerminalFocused || isSearchVisible)) {
        event.preventDefault();
        event.stopPropagation();
        setIsSearchVisible(true);
      }

      if (event.key === "Escape" && isSearchVisible) {
        event.preventDefault();
        setIsSearchVisible(false);
        clearSearch();
        xtermRef.current?.focus();
      }

      if (isTerminalFocused && (event.ctrlKey || event.metaKey)) {
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          handleZoom(2);
        } else if (event.key === "-") {
          event.preventDefault();
          handleZoom(-2);
        } else if (event.key === "0") {
          event.preventDefault();
          handleZoomReset();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [clearSearch, handleZoom, handleZoomReset, isActive, isSearchVisible]);

  const handleSearch = useCallback(
    (term: string, options: TerminalSearchOptions) => {
      if (!term || !addonsRef.current) {
        clearSearch();
        return;
      }

      const found = addonsRef.current.searchAddon.findNext(term, {
        ...getSearchOptions(options),
        incremental: true,
      });

      if (!found) {
        setSearchResults({ current: 0, total: 0 });
      }
    },
    [clearSearch, getSearchOptions],
  );

  const handleSearchNext = useCallback(
    (term: string, options: TerminalSearchOptions) => {
      if (!term || !addonsRef.current) return;
      addonsRef.current.searchAddon.findNext(term, getSearchOptions(options));
    },
    [getSearchOptions],
  );

  const handleSearchPrevious = useCallback(
    (term: string, options: TerminalSearchOptions) => {
      if (!term || !addonsRef.current) return;
      addonsRef.current.searchAddon.findPrevious(term, getSearchOptions(options));
    },
    [getSearchOptions],
  );

  const handleSearchClose = useCallback(() => {
    setIsSearchVisible(false);
    clearSearch();
    xtermRef.current?.focus();
  }, [clearSearch]);

  React.useImperativeHandle(
    getSession(sessionId)?.ref,
    () => ({
      terminal: xtermRef.current,
      searchAddon: addonsRef.current?.searchAddon,
      focus: () => xtermRef.current?.focus(),
      showSearch: () => setIsSearchVisible(true),
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
      resize: () => fitTerminal(4),
    }),
    [fitTerminal, getSession, isInitialized, sessionId],
  );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-primary-bg">
      <TerminalSearch
        isVisible={isSearchVisible}
        onSearch={handleSearch}
        onNext={handleSearchNext}
        onPrevious={handleSearchPrevious}
        onClose={handleSearchClose}
        currentMatch={searchResults.current}
        totalMatches={searchResults.total}
      />
      <div className="min-h-0 flex-1 pl-[16px]">
        <div
          ref={terminalContainerRef}
          id={`terminal-${sessionId}`}
          className={`xterm-container h-full min-h-0 text-text ${!isActive ? "opacity-60" : ""}`}
        />
      </div>
    </div>
  );
};
