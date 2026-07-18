import { invoke } from "@tauri-apps/api/core";
import type { ISearchOptions } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { getWslShellId, parseWslPath } from "@/features/wsl/utils/wsl-path";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useZoomStore } from "@/features/window/stores/zoom.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { extractDroppedFilePaths } from "@/features/file-system/utils/file-system-dropped-paths";
import { showConfirmDialog } from "@/features/dialogs/services/dialog-service";
import { readClipboardText, writeClipboardText } from "@/utils/clipboard";
import { currentPlatform } from "@/utils/platform";
import {
  createTerminalAddons,
  injectLinkStyles,
  loadWebLinksAddon,
  registerFileLinksProvider,
  removeLinkStyles,
  type TerminalAddons,
} from "../hooks/use-terminal-addons";
import { useTerminalConnection } from "../hooks/use-terminal-connection";
import { useTerminalTheme } from "../hooks/use-terminal-theme";
import { useTerminalStore } from "../stores/terminal.store";
import { formatDroppedPathsForTerminal } from "../utils/terminal-file-drop";
import { resolveTerminalFont } from "../utils/resolve-font";
import { getTerminalKeyAction } from "../utils/terminal-keyboard";
import { getTerminalCompatibilityOptions } from "../utils/terminal-options";
import { createTerminalEventChannel, getTerminalSize } from "../utils/terminal-protocol";
import { TerminalSearch, type TerminalSearchOptions } from "./terminal-search";
import "@xterm/xterm/css/xterm.css";
import "../styles/terminal.css";

const MULTILINE_PASTE_LINE_THRESHOLD = 5;
const LARGE_PASTE_CHAR_THRESHOLD = 1000;

interface XtermTerminalProps {
  sessionId: string;
  isActive: boolean;
  isVisible?: boolean;
  onReady?: () => void;
  onTerminalRef?: (ref: { focus: () => void; showSearch: () => void; terminal: Terminal }) => void;
  onTerminalExit?: (sessionId: string) => void;
  initialCommand?: string;
  workingDirectory?: string;
  remoteConnectionId?: string;
}

export const XtermTerminal = ({
  sessionId,
  isActive,
  isVisible = true,
  onReady,
  onTerminalRef,
  onTerminalExit,
  initialCommand,
  workingDirectory,
  remoteConnectionId,
}: XtermTerminalProps) => {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const addonsRef = useRef<TerminalAddons | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState({ current: 0, total: 0 });
  const isInitializingRef = useRef(false);
  const fitFrameRef = useRef<number | null>(null);

  const updateSession = useTerminalStore((state) => state.updateSession);
  const getSession = useTerminalStore((state) => state.getSession);
  const session = useTerminalStore((state) => state.sessions.get(sessionId));
  const connectionId = session?.connectionId;
  const hadExistingConnectionOnMountRef = useRef(Boolean(session?.connectionId));

  const terminalThemeId = useSettingsStore((state) => state.settings.theme);
  const terminalFontFamily = useSettingsStore((state) => state.settings.terminalFontFamily);
  const terminalFontSize = useSettingsStore((state) => state.settings.terminalFontSize);
  const terminalLineHeight = useSettingsStore((state) => state.settings.terminalLineHeight);
  const terminalLetterSpacing = useSettingsStore((state) => state.settings.terminalLetterSpacing);
  const terminalScrollback = useSettingsStore((state) => state.settings.terminalScrollback);
  const terminalCursorStyle = useSettingsStore((state) => state.settings.terminalCursorStyle);
  const terminalCursorBlink = useSettingsStore((state) => state.settings.terminalCursorBlink);
  const terminalCursorWidth = useSettingsStore((state) => state.settings.terminalCursorWidth);
  const zoomLevel = useZoomStore.use.terminalZoomLevel();
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const workspaceRootRef = useRef(rootFolderPath);
  const { getTerminalTheme } = useTerminalTheme();
  const effectiveTerminalFontSize = Math.round(terminalFontSize * zoomLevel * 10) / 10;
  const effectiveTerminalLetterSpacing = terminalLetterSpacing * zoomLevel;
  const effectiveTerminalCursorWidth = Math.max(1, Math.round(terminalCursorWidth * zoomLevel));
  const terminalIsRemote = Boolean(
    remoteConnectionId ||
    session?.remoteConnectionId ||
    parseRemotePath(workingDirectory || session?.currentDirectory || rootFolderPath || ""),
  );

  useEffect(() => {
    workspaceRootRef.current = rootFolderPath;
  }, [rootFolderPath]);

  const { currentConnectionIdRef, sendTerminalSize, writeBuffered } = useTerminalConnection({
    connectionId,
    getTerminalTheme,
    initialCommand,
    isInitialized,
    onTerminalExit,
    remoteConnectionId,
    reuseExistingConnection: hadExistingConnectionOnMountRef.current,
    sessionId,
    terminal: xtermRef.current,
    updateSession,
  });

  const fitTerminal = useCallback(() => {
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;
      const container = terminalContainerRef.current;
      const addons = addonsRef.current;
      const terminal = xtermRef.current;
      if (!container || !addons || !terminal) return;

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || container.offsetParent === null) {
        return;
      }

      addons.fitAddon.fit();
      sendTerminalSize(terminal);
      terminal.refresh(0, terminal.rows - 1);
    });
  }, [sendTerminalSize]);

  const handleTerminalFileDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const paths = extractDroppedFilePaths(event.dataTransfer);
      const text = formatDroppedPathsForTerminal(paths);
      if (!text) return;

      event.preventDefault();
      event.stopPropagation();
      writeBuffered(text);
      requestAnimationFrame(() => xtermRef.current?.focus());
    },
    [writeBuffered],
  );

  const handleTerminalDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const pasteIntoTerminal = useCallback(async (terminal: Terminal, text: string) => {
    if (!text) return;

    const lineCount = text.replace(/\r\n/g, "\n").split("\n").length;
    const requiresConfirmation =
      lineCount >= MULTILINE_PASTE_LINE_THRESHOLD || text.length >= LARGE_PASTE_CHAR_THRESHOLD;

    if (
      requiresConfirmation &&
      !(await showConfirmDialog(
        `Paste ${lineCount} lines into the terminal? This may execute multiple commands.`,
        { title: "Paste Into Terminal", confirmLabel: "Paste" },
      ))
    ) {
      return;
    }

    terminal.paste(text);
  }, []);

  const initializeTerminal = useCallback(async () => {
    const container = terminalContainerRef.current;
    if (!container || isInitialized || isInitializingRef.current) return;

    const rect = container.getBoundingClientRect();
    const isContainerVisible = container.offsetParent !== null;
    if (rect.width <= 0 || rect.height <= 0 || !isContainerVisible) return;

    isInitializingRef.current = true;
    const resolved = await resolveTerminalFont(terminalFontFamily, effectiveTerminalFontSize);

    if (!terminalContainerRef.current) {
      isInitializingRef.current = false;
      return;
    }

    try {
      const terminal = new Terminal({
        fontFamily: resolved.fontFamily,
        fontSize: effectiveTerminalFontSize,
        lineHeight: terminalLineHeight,
        letterSpacing: effectiveTerminalLetterSpacing,
        cursorBlink: terminalCursorBlink,
        cursorStyle: terminalCursorStyle,
        cursorWidth: effectiveTerminalCursorWidth,
        allowProposedApi: true,
        theme: getTerminalTheme(),
        scrollback: terminalScrollback,
        convertEol: false,
        macOptionIsMeta: false,
        rightClickSelectsWord: false,
        ...getTerminalCompatibilityOptions({ isRemote: terminalIsRemote }),
      });

      terminal.open(terminalContainerRef.current);
      const addons = createTerminalAddons(terminal, {
        onRendererFallback: fitTerminal,
      });
      terminal.attachCustomKeyEventHandler((event) => {
        const action = getTerminalKeyAction(event, currentPlatform);
        if (action.type === "switchTab") {
          event.preventDefault();
          window.dispatchEvent(
            new CustomEvent("terminal-switch-tab", {
              detail: action.direction,
            }),
          );
          return false;
        }

        if (action.type === "write") {
          event.preventDefault();
          writeBuffered(action.data);
          return false;
        }

        if (action.type === "copy") {
          event.preventDefault();
          const selection = terminal.getSelection();
          if (selection) {
            void writeClipboardText(selection).catch((error) =>
              console.error("Failed to copy terminal selection:", error),
            );
          }
          return false;
        }

        if (action.type === "paste") {
          event.preventDefault();
          void readClipboardText()
            .then((text) => pasteIntoTerminal(terminal, text))
            .catch((error) => console.error("Failed to paste into terminal:", error));
          return false;
        }

        return action.type === "passthrough";
      });

      if (terminal.textarea) {
        terminal.textarea.spellcheck = false;
        terminal.textarea.addEventListener("beforeinput", (event) => {
          if (event.inputType === "insertReplacementText" || event.inputType === "insertFromDrop") {
            const text = event.dataTransfer?.getData("text/plain") ?? event.data;
            if (!text || !currentConnectionIdRef.current) return;

            event.preventDefault();
            writeBuffered(text);
          }
        });

        terminal.textarea.addEventListener(
          "paste",
          (event) => {
            const text = event.clipboardData?.getData("text/plain");
            if (!text || !currentConnectionIdRef.current) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            void pasteIntoTerminal(terminal, text);
          },
          true,
        );
      }

      loadWebLinksAddon(terminal);
      registerFileLinksProvider(terminal, {
        getWorkspaceRoot: () => workspaceRootRef.current,
        openFile: async (link) => {
          await useFileSystemStore
            .getState()
            .handleFileSelect(link.path, false, link.line, link.column);
        },
      });
      terminal.unicode.activeVersion = "11";
      injectLinkStyles(sessionId, terminalContainerRef.current.id || `terminal-${sessionId}`);

      xtermRef.current = terminal;
      addonsRef.current = addons;

      // Fit synchronously after open so terminal.rows/cols reflect the actual container size
      // before we create the PTY with those dimensions
      addons.fitAddon.fit();

      const existingSession = getSession(sessionId);

      // If the session already has a live PTY connection (e.g., component
      // remounted after a pane split or tab move), reuse the existing
      // connection instead of killing the running process.
      let activeConnectionId: string;
      if (existingSession?.connectionId) {
        activeConnectionId = existingSession.connectionId;
      } else {
        const targetDirectory =
          workingDirectory || existingSession?.currentDirectory || rootFolderPath;
        const remoteInfo = targetDirectory ? parseRemotePath(targetDirectory) : null;
        const wslInfo = targetDirectory ? parseWslPath(targetDirectory) : null;
        const effectiveRemoteConnectionId = remoteConnectionId || remoteInfo?.connectionId;
        const size = getTerminalSize(terminal);
        const events = createTerminalEventChannel();

        activeConnectionId = effectiveRemoteConnectionId
          ? await (async () => {
              const connection = await connectionStore.getConnection(effectiveRemoteConnectionId);
              if (!connection) {
                throw new Error("Remote terminal connection not found.");
              }

              return invoke<string>("create_remote_terminal", {
                host: connection.host,
                port: connection.port,
                username: connection.username,
                password: connection.password || null,
                keyPath: connection.keyPath || null,
                workingDirectory: remoteInfo?.remotePath || "/",
                size,
                onEvent: events.channel,
              });
            })()
          : await invoke<string>("create_terminal", {
              config: {
                workingDirectory: targetDirectory || undefined,
                shell:
                  existingSession?.shell || (wslInfo ? getWslShellId(wslInfo.distro) : undefined),
                wslDistribution: wslInfo?.distro,
                wslWorkingDirectory: wslInfo?.linuxPath,
                size,
              },
              onEvent: events.channel,
            });

        events.bind(activeConnectionId);

        updateSession(sessionId, {
          connectionId: activeConnectionId,
          currentDirectory: targetDirectory,
          remoteConnectionId: effectiveRemoteConnectionId,
        });
      }

      // No snapshot replay: xterm is portaled and never remounts mid-session,
      // so the live PTY redrawing via SIGWINCH is the source of truth.

      setIsInitialized(true);
      isInitializingRef.current = false;

      // Re-fit after connection is established so onResize can notify the PTY
      fitTerminal();

      window.dispatchEvent(
        new CustomEvent("terminal-ready", {
          detail: { terminalId: sessionId, connectionId: activeConnectionId },
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
    pasteIntoTerminal,
    rootFolderPath,
    remoteConnectionId,
    sessionId,
    terminalCursorBlink,
    terminalCursorStyle,
    terminalCursorWidth,
    terminalFontFamily,
    effectiveTerminalCursorWidth,
    effectiveTerminalFontSize,
    effectiveTerminalLetterSpacing,
    terminalLineHeight,
    terminalScrollback,
    terminalIsRemote,
    updateSession,
    workingDirectory,
    writeBuffered,
  ]);

  useEffect(() => {
    if (!xtermRef.current) return;
    xtermRef.current.options.theme = getTerminalTheme();
    fitTerminal();
  }, [terminalThemeId, getTerminalTheme, fitTerminal]);

  useEffect(() => {
    if (!xtermRef.current || !addonsRef.current) return;

    let cancelled = false;

    const applyFontChange = async () => {
      const resolved = await resolveTerminalFont(terminalFontFamily, effectiveTerminalFontSize);
      if (cancelled || !xtermRef.current || !addonsRef.current) return;

      xtermRef.current.options.fontFamily = resolved.fontFamily;
      xtermRef.current.options.fontSize = effectiveTerminalFontSize;
      xtermRef.current.options.lineHeight = terminalLineHeight;
      xtermRef.current.options.letterSpacing = effectiveTerminalLetterSpacing;
      xtermRef.current.options.scrollback = terminalScrollback;
      xtermRef.current.options.cursorBlink = terminalCursorBlink;
      xtermRef.current.options.cursorStyle = terminalCursorStyle;
      xtermRef.current.options.cursorWidth = effectiveTerminalCursorWidth;

      fitTerminal();
    };

    void applyFontChange();

    return () => {
      cancelled = true;
    };
  }, [
    terminalFontFamily,
    effectiveTerminalCursorWidth,
    effectiveTerminalFontSize,
    effectiveTerminalLetterSpacing,
    terminalLineHeight,
    terminalScrollback,
    terminalCursorBlink,
    terminalCursorStyle,
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

  // Dispose only the xterm UI on unmount. The PTY process is owned by
  // the buffer store and killed in closeBufferForce when the user actually
  // closes the tab — NOT here. This prevents pane splits, tab moves, and
  // other layout changes from killing running terminal processes.
  useEffect(() => {
    return () => {
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
        addonsRef.current = null;
      }
    };
  }, []);

  // XtermTerminal stays mounted while slots move between panes. When a new
  // slot owner provides a fresh ref callback, hand the live terminal handle to
  // it even though initialization does not re-run.
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!isInitialized || !terminal || !onTerminalRef) return;

    onTerminalRef({
      focus: () => terminal.focus(),
      showSearch: () => setIsSearchVisible(true),
      terminal,
    });
  }, [isInitialized, onTerminalRef]);

  // Listen for portal-target changes from TerminalHost; force a fit + repaint
  // so PTY/xterm dims match the new slot before any TUI relies on them.
  useEffect(() => {
    if (!isInitialized) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string }>).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      fitTerminal();
    };
    window.addEventListener("athas-terminal-refit", handler);
    return () => window.removeEventListener("athas-terminal-refit", handler);
  }, [fitTerminal, isInitialized, sessionId]);

  useEffect(() => {
    if (!addonsRef.current || !terminalContainerRef.current || !isInitialized) return;

    const resizeObserver = new ResizeObserver(fitTerminal);
    const visualViewport = window.visualViewport;

    resizeObserver.observe(terminalContainerRef.current);
    window.addEventListener("resize", fitTerminal);
    visualViewport?.addEventListener("resize", fitTerminal);
    document.fonts.addEventListener("loadingdone", fitTerminal);
    void document.fonts.ready.then(fitTerminal);
    fitTerminal();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", fitTerminal);
      visualViewport?.removeEventListener("resize", fitTerminal);
      document.fonts.removeEventListener("loadingdone", fitTerminal);
    };
  }, [fitTerminal, isInitialized]);

  useEffect(() => {
    if (!isActive || !isVisible || !xtermRef.current || !isInitialized) return;

    let cancelled = false;

    // Fit the terminal first to recalculate dimensions after display:none → display:flex
    fitTerminal();

    // Focus with verified retry — wait for layout to fully settle after tab switch
    const ensureFocus = (attempt: number) => {
      if (cancelled || !xtermRef.current || attempt >= 8) return;

      xtermRef.current.focus();

      // Verify the textarea actually received focus
      requestAnimationFrame(() => {
        if (cancelled || !xtermRef.current) return;
        const textarea = xtermRef.current.textarea;
        if (textarea && document.activeElement !== textarea) {
          ensureFocus(attempt + 1);
        }
      });
    };

    // Wait 2 frames for DOM layout to settle after display change, then focus
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) ensureFocus(0);
      });
    });

    return () => {
      cancelled = true;
    };
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
        fitTerminal();
      }
    },
    [fitTerminal, terminalFontSize],
  );

  const handleZoomReset = useCallback(() => {
    useSettingsStore.getState().updateSetting("terminalFontSize", 14);
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = 14;
      fitTerminal();
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

      if (
        (event.ctrlKey || event.metaKey) &&
        key === "f" &&
        (isTerminalFocused || isSearchVisible)
      ) {
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

  useImperativeHandle(
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
      resize: () => fitTerminal(),
    }),
    [fitTerminal, getSession, isInitialized, sessionId],
  );

  return (
    <div className="relative flex size-full min-w-0 flex-col overflow-hidden bg-primary-bg">
      <TerminalSearch
        isVisible={isSearchVisible}
        onSearch={handleSearch}
        onNext={handleSearchNext}
        onPrevious={handleSearchPrevious}
        onClose={handleSearchClose}
        currentMatch={searchResults.current}
        totalMatches={searchResults.total}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-[16px]">
        <div
          ref={terminalContainerRef}
          id={`terminal-${sessionId}`}
          data-terminal-drop-target
          data-terminal-session-id={sessionId}
          className={`xterm-container flex h-full min-h-0 min-w-0 flex-1 text-text ${!isActive ? "opacity-60" : ""}`}
          onDragOver={handleTerminalDragOver}
          onDrop={handleTerminalFileDrop}
          onMouseDown={() => {
            requestAnimationFrame(() => xtermRef.current?.focus());
          }}
        />
      </div>
    </div>
  );
};
