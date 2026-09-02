import { invoke } from "@tauri-apps/api/core";
import type { ISearchOptions } from "@xterm/addon-search";
import { Terminal as XtermInstance } from "@xterm/xterm";
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
import {
  TERMINAL_FILE_DROP_EVENT,
  type TerminalFileDropDetail,
} from "@/features/file-system/utils/file-system-drop-controller";
import { showConfirmDialog } from "@/ui/dialog";
import { useToast } from "@/features/layout/contexts/toast-context";
import { readClipboardText, writeClipboardText } from "@/utils/clipboard";
import { frontendTrace } from "@/utils/frontend-trace";
import { currentPlatform } from "@/utils/platform";
import {
  createTerminalAddons,
  injectLinkStyles,
  loadWebLinksAddon,
  registerFileLinksProvider,
  removeLinkStyles,
} from "../hooks/use-terminal-addons";
import { useTerminalConnection } from "../hooks/use-terminal-connection";
import { useTerminalTheme, type TerminalTheme } from "../hooks/use-terminal-theme";
import { createGhosttyTerminalRuntime } from "../lib/ghostty-terminal-runtime";
import { useTerminalStore } from "../stores/terminal.store";
import type {
  TerminalEngine,
  TerminalFrontend,
  TerminalRuntimeAddons,
} from "../types/terminal-frontend.types";
import { formatDroppedPathsForTerminal } from "../utils/terminal-file-drop";
import { resolveTerminalFont } from "../utils/resolve-font";
import { getTerminalKeyAction } from "../utils/terminal-keyboard";
import { getTerminalCompatibilityOptions } from "../utils/terminal-options";
import { createTerminalEventChannel, getTerminalSize } from "../utils/terminal-protocol";
import { getFrontendTerminalSessionArgs } from "../utils/frontend-terminal-session";
import { TerminalSearch, type TerminalSearchOptions } from "./terminal-search";
import "@xterm/xterm/css/xterm.css";
import "../styles/terminal.css";

const MULTILINE_PASTE_LINE_THRESHOLD = 5;
const LARGE_PASTE_CHAR_THRESHOLD = 1000;

interface TerminalEmulatorProps {
  engine: TerminalEngine;
  sessionId: string;
  isActive: boolean;
  isVisible?: boolean;
  onReady?: () => void;
  onTerminalRef?: (ref: {
    focus: () => void;
    showSearch: () => void;
    terminal: TerminalFrontend;
  }) => void;
  onTerminalExit?: (sessionId: string) => void;
  shell?: string;
  initialCommand?: string;
  environment?: Record<string, string>;
  workingDirectory?: string;
  remoteConnectionId?: string;
}

export const TerminalEmulator = ({
  engine,
  sessionId,
  isActive,
  isVisible = true,
  onReady,
  onTerminalRef,
  onTerminalExit,
  shell,
  initialCommand,
  environment,
  workingDirectory,
  remoteConnectionId,
}: TerminalEmulatorProps) => {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalFrontend | null>(null);
  const addonsRef = useRef<TerminalRuntimeAddons | null>(null);
  const activeEngineRef = useRef<TerminalEngine>(engine);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchResults, setSearchResults] = useState({ current: 0, total: 0 });
  const isInitializingRef = useRef(false);
  const fitFrameRef = useRef<number | null>(null);
  const { showToast } = useToast();

  const updateSession = useTerminalStore((state) => state.actions.updateSession);
  const getSession = useTerminalStore((state) => state.actions.getSession);
  const session = useTerminalStore((state) => state.sessions.get(sessionId));
  const connectionId = session?.connectionId;
  const hadExistingConnectionOnMountRef = useRef(Boolean(session?.connectionId));
  const terminalInputCleanupRef = useRef<() => void>(() => {});

  const terminalThemeId = useSettingsStore((state) => state.settings.theme);
  const terminalFontFamily = useSettingsStore((state) => state.settings.terminalFontFamily);
  const terminalFontSize = useSettingsStore((state) => state.settings.terminalFontSize);
  const terminalLineHeight = useSettingsStore((state) => state.settings.terminalLineHeight);
  const terminalLetterSpacing = useSettingsStore((state) => state.settings.terminalLetterSpacing);
  const terminalScrollback = useSettingsStore((state) => state.settings.terminalScrollback);
  const terminalCursorStyle = useSettingsStore((state) => state.settings.terminalCursorStyle);
  const terminalCursorBlink = useSettingsStore((state) => state.settings.terminalCursorBlink);
  const terminalCursorWidth = useSettingsStore((state) => state.settings.terminalCursorWidth);
  const terminalCursorInactiveStyle = useSettingsStore(
    (state) => state.settings.terminalCursorInactiveStyle,
  );
  const terminalAltClickMovesCursor = useSettingsStore(
    (state) => state.settings.terminalAltClickMovesCursor,
  );
  const terminalMacOptionIsMeta = useSettingsStore(
    (state) => state.settings.terminalMacOptionIsMeta,
  );
  const terminalRightClickSelectsWord = useSettingsStore(
    (state) => state.settings.terminalRightClickSelectsWord,
  );
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

  const applyTerminalTheme = useCallback((theme: TerminalTheme) => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (activeEngineRef.current === "ghostty") {
      const ghosttyRenderer = (
        terminal as TerminalFrontend & {
          renderer?: { setTheme: (nextTheme: TerminalTheme) => void };
        }
      ).renderer;
      ghosttyRenderer?.setTheme(theme);
      return;
    }

    (terminal as XtermInstance).options.theme = theme;
  }, []);

  const { currentConnectionIdRef, sendTerminalSize, writeBuffered } = useTerminalConnection({
    applyTerminalTheme,
    connectionId,
    getTerminalTheme,
    initialCommand,
    isInitialized,
    onTerminalExit,
    remoteConnectionId,
    reuseExistingConnection: hadExistingConnectionOnMountRef.current,
    sessionId,
    terminal: terminalRef.current,
    updateSession,
  });

  const fitTerminal = useCallback(() => {
    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;
      const container = terminalContainerRef.current;
      const addons = addonsRef.current;
      const terminal = terminalRef.current;
      if (!container || !addons || !terminal) return;

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || container.offsetParent === null) {
        return;
      }

      addons.fitAddon.fit();
      sendTerminalSize(terminal);
      terminal.refresh?.(0, terminal.rows - 1);
    });
  }, [sendTerminalSize]);

  const insertDroppedPaths = useCallback(
    (paths: string[]) => {
      const text = formatDroppedPathsForTerminal(paths);
      if (!text) return false;

      writeBuffered(text);
      requestAnimationFrame(() => terminalRef.current?.focus());
      return true;
    },
    [writeBuffered],
  );

  const handleTerminalFileDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!insertDroppedPaths(extractDroppedFilePaths(event.dataTransfer))) return;

      event.preventDefault();
      event.stopPropagation();
    },
    [insertDroppedPaths],
  );

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    const handleNativeFileDrop = (event: Event) => {
      const detail = (event as CustomEvent<TerminalFileDropDetail>).detail;
      insertDroppedPaths(detail?.paths ?? []);
    };

    container.addEventListener(TERMINAL_FILE_DROP_EVENT, handleNativeFileDrop);
    return () => container.removeEventListener(TERMINAL_FILE_DROP_EVENT, handleNativeFileDrop);
  }, [insertDroppedPaths]);

  const handleTerminalDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const pasteIntoTerminal = useCallback(async (terminal: TerminalFrontend, text: string) => {
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
    const initializationStartedAt = performance.now();
    const resolved = await resolveTerminalFont(terminalFontFamily, effectiveTerminalFontSize);

    if (!terminalContainerRef.current) {
      isInitializingRef.current = false;
      return;
    }

    try {
      let activeEngine = engine;
      let terminal: TerminalFrontend | null = null;
      let addons: TerminalRuntimeAddons | null = null;

      if (activeEngine === "ghostty") {
        try {
          const runtime = await createGhosttyTerminalRuntime({
            fontFamily: resolved.fontFamily,
            fontSize: effectiveTerminalFontSize,
            cursorBlink: terminalCursorBlink,
            cursorStyle: terminalCursorStyle,
            theme: getTerminalTheme(),
            scrollback: terminalScrollback,
            convertEol: false,
            smoothScrollDuration: 0,
          });
          terminal = runtime.terminal;
          addons = runtime.addons;
          terminal.open(terminalContainerRef.current);
        } catch (error) {
          console.error("Failed to initialize the experimental Ghostty terminal:", error);
          showToast({
            message: "Ghostty could not start. This terminal is using xterm instead.",
            type: "error",
          });
          activeEngine = "xterm";
        }
      }

      if (activeEngine === "xterm") {
        const xterm = new XtermInstance({
          fontFamily: resolved.fontFamily,
          fontSize: effectiveTerminalFontSize,
          lineHeight: terminalLineHeight,
          letterSpacing: effectiveTerminalLetterSpacing,
          cursorBlink: terminalCursorBlink,
          cursorStyle: terminalCursorStyle,
          cursorWidth: effectiveTerminalCursorWidth,
          cursorInactiveStyle: terminalCursorInactiveStyle,
          altClickMovesCursor: terminalAltClickMovesCursor,
          allowProposedApi: true,
          theme: getTerminalTheme(),
          scrollback: terminalScrollback,
          convertEol: false,
          macOptionIsMeta: terminalMacOptionIsMeta,
          rightClickSelectsWord: terminalRightClickSelectsWord,
          ...getTerminalCompatibilityOptions({ isRemote: terminalIsRemote }),
        });

        xterm.open(terminalContainerRef.current);
        terminal = xterm;
        addons = createTerminalAddons(xterm, {
          onRendererFallback: fitTerminal,
        });
      }

      if (!terminal || !addons) {
        throw new Error("No terminal frontend was created.");
      }

      activeEngineRef.current = activeEngine;
      const handleCustomKeyEvent = (event: KeyboardEvent) => {
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
      };
      terminal.attachCustomKeyEventHandler((event) => {
        const shouldProcess = handleCustomKeyEvent(event);
        return activeEngine === "ghostty" ? !shouldProcess : shouldProcess;
      });

      const textarea = terminal.textarea;
      if (textarea) {
        const handleBeforeInput = (event: InputEvent) => {
          if (event.inputType === "insertReplacementText" || event.inputType === "insertFromDrop") {
            const text = event.dataTransfer?.getData("text/plain") ?? event.data;
            if (!text || !currentConnectionIdRef.current) return;

            event.preventDefault();
            writeBuffered(text);
          }
        };

        const handlePaste = (event: ClipboardEvent) => {
          const text = event.clipboardData?.getData("text/plain");
          if (!text || !currentConnectionIdRef.current) return;

          event.preventDefault();
          event.stopImmediatePropagation();
          void pasteIntoTerminal(terminal, text);
        };

        textarea.spellcheck = false;
        textarea.addEventListener("beforeinput", handleBeforeInput);
        textarea.addEventListener("paste", handlePaste, true);
        terminalInputCleanupRef.current = () => {
          textarea.removeEventListener("beforeinput", handleBeforeInput);
          textarea.removeEventListener("paste", handlePaste, true);
        };
      }

      if (activeEngine === "xterm") {
        const xterm = terminal as XtermInstance;
        loadWebLinksAddon(xterm);
        registerFileLinksProvider(xterm, {
          getWorkspaceRoot: () => workspaceRootRef.current,
          openFile: async (link) => {
            await useFileSystemStore
              .getState()
              .handleFileSelect(link.path, false, link.line, link.column);
          },
        });
        xterm.unicode.activeVersion = "11";
        injectLinkStyles(sessionId, terminalContainerRef.current.id || `terminal-${sessionId}`);
      }

      terminalRef.current = terminal;
      addonsRef.current = addons;
      const engineTraceMessage =
        activeEngine === engine
          ? `${activeEngine}:ready`
          : `${activeEngine}:fallback-from-${engine}`;
      frontendTrace("info", "bench:terminal-engine", engineTraceMessage, {
        durationMs: Math.round(performance.now() - initializationStartedAt),
        engine: activeEngine,
        requestedEngine: engine,
      });

      // Fit synchronously after open so terminal.rows/cols reflect the actual container size
      // before we create the PTY with those dimensions
      addons.fitAddon.fit();

      const existingSession = getSession(sessionId);

      // If the session already has a live PTY connection (e.g., component
      // remounted after a pane split or tab move), reuse the existing
      // connection instead of killing the running process.
      let activeConnectionId: string;
      let activeRemoteConnectionId = remoteConnectionId || existingSession?.remoteConnectionId;
      if (existingSession?.connectionId) {
        activeConnectionId = existingSession.connectionId;
      } else {
        const targetDirectory =
          workingDirectory || existingSession?.currentDirectory || rootFolderPath;
        const remoteInfo = targetDirectory ? parseRemotePath(targetDirectory) : null;
        const wslInfo = targetDirectory ? parseWslPath(targetDirectory) : null;
        activeRemoteConnectionId = activeRemoteConnectionId || remoteInfo?.connectionId;
        const size = getTerminalSize(terminal);
        const events = createTerminalEventChannel();

        activeConnectionId = activeRemoteConnectionId
          ? await (async () => {
              const connection = await connectionStore.getConnection(activeRemoteConnectionId);
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
                ...getFrontendTerminalSessionArgs(),
              });
            })()
          : await invoke<string>("create_terminal", {
              config: {
                workingDirectory: targetDirectory || undefined,
                shell:
                  shell ||
                  existingSession?.shell ||
                  (wslInfo ? getWslShellId(wslInfo.distro) : undefined),
                wslDistribution: wslInfo?.distro,
                wslWorkingDirectory: wslInfo?.linuxPath,
                environment,
                size,
              },
              onEvent: events.channel,
              ...getFrontendTerminalSessionArgs(),
            });

        events.bind(activeConnectionId);

        updateSession(sessionId, {
          connectionId: activeConnectionId,
          currentDirectory: targetDirectory,
          remoteConnectionId: activeRemoteConnectionId,
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
          detail: {
            terminalId: sessionId,
            connectionId: activeConnectionId,
            remoteConnectionId: activeRemoteConnectionId,
          },
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
    engine,
    environment,
    fitTerminal,
    getSession,
    getTerminalTheme,
    isInitialized,
    onReady,
    onTerminalRef,
    pasteIntoTerminal,
    rootFolderPath,
    remoteConnectionId,
    shell,
    sessionId,
    showToast,
    terminalCursorBlink,
    terminalCursorInactiveStyle,
    terminalCursorStyle,
    terminalCursorWidth,
    terminalAltClickMovesCursor,
    terminalFontFamily,
    effectiveTerminalCursorWidth,
    effectiveTerminalFontSize,
    effectiveTerminalLetterSpacing,
    terminalLineHeight,
    terminalMacOptionIsMeta,
    terminalRightClickSelectsWord,
    terminalScrollback,
    terminalIsRemote,
    updateSession,
    workingDirectory,
    writeBuffered,
  ]);

  useEffect(() => {
    if (!terminalRef.current) return;
    applyTerminalTheme(getTerminalTheme());
    fitTerminal();
  }, [applyTerminalTheme, terminalThemeId, getTerminalTheme, fitTerminal]);

  useEffect(() => {
    if (!terminalRef.current || !addonsRef.current) return;

    let cancelled = false;

    const applyFontChange = async () => {
      const resolved = await resolveTerminalFont(terminalFontFamily, effectiveTerminalFontSize);
      const terminal = terminalRef.current;
      if (cancelled || !terminal || !addonsRef.current) return;

      if (activeEngineRef.current === "ghostty") {
        const options = (
          terminal as TerminalFrontend & {
            options: {
              cursorBlink: boolean;
              cursorStyle: "block" | "underline" | "bar";
              fontFamily: string;
              fontSize: number;
              scrollback: number;
            };
          }
        ).options;
        options.fontFamily = resolved.fontFamily;
        options.fontSize = effectiveTerminalFontSize;
        options.scrollback = terminalScrollback;
        options.cursorBlink = terminalCursorBlink;
        options.cursorStyle = terminalCursorStyle;
      } else {
        const options = (terminal as XtermInstance).options;
        options.fontFamily = resolved.fontFamily;
        options.fontSize = effectiveTerminalFontSize;
        options.lineHeight = terminalLineHeight;
        options.letterSpacing = effectiveTerminalLetterSpacing;
        options.scrollback = terminalScrollback;
        options.cursorBlink = terminalCursorBlink;
        options.cursorStyle = terminalCursorStyle;
        options.cursorWidth = effectiveTerminalCursorWidth;
        options.cursorInactiveStyle = terminalCursorInactiveStyle;
        options.altClickMovesCursor = terminalAltClickMovesCursor;
        options.macOptionIsMeta = terminalMacOptionIsMeta;
        options.rightClickSelectsWord = terminalRightClickSelectsWord;
      }

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
    terminalCursorInactiveStyle,
    terminalCursorStyle,
    terminalAltClickMovesCursor,
    terminalMacOptionIsMeta,
    terminalRightClickSelectsWord,
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

  // Dispose only the terminal frontend on unmount. The PTY process is owned by
  // the buffer store and killed in closeBufferForce when the user actually
  // closes the tab — NOT here. This prevents pane splits, tab moves, and
  // other layout changes from killing running terminal processes.
  useEffect(() => {
    return () => {
      terminalInputCleanupRef.current();
      terminalInputCleanupRef.current = () => {};
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
        addonsRef.current = null;
      }
    };
  }, []);

  // The terminal frontend stays mounted while slots move between panes. When a new
  // slot owner provides a fresh ref callback, hand the live terminal handle to
  // it even though initialization does not re-run.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!isInitialized || !terminal || !onTerminalRef) return;

    onTerminalRef({
      focus: () => terminal.focus(),
      showSearch: () => setIsSearchVisible(true),
      terminal,
    });
  }, [isInitialized, onTerminalRef]);

  // Listen for portal-target changes from TerminalHost; force a fit + repaint
  // so PTY/frontend dims match the new slot before any TUI relies on them.
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
    if (!isActive || !isVisible || !terminalRef.current || !isInitialized) return;

    let cancelled = false;

    // Fit the terminal first to recalculate dimensions after display:none → display:flex
    fitTerminal();

    // Focus with verified retry — wait for layout to fully settle after tab switch
    const ensureFocus = (attempt: number) => {
      if (cancelled || !terminalRef.current || attempt >= 8) return;

      terminalRef.current.focus();

      requestAnimationFrame(() => {
        if (cancelled || !terminalRef.current) return;
        const textarea = terminalRef.current.textarea;
        const terminalElement = terminalRef.current.element;
        const activeElement = document.activeElement;
        const hasTerminalFocus =
          activeElement === textarea ||
          activeElement === terminalElement ||
          terminalElement?.contains(activeElement);

        if (textarea && !hasTerminalFocus) {
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
      useSettingsStore.getState().actions.updateSetting("terminalFontSize", newSize);
      if (terminalRef.current) {
        if (activeEngineRef.current === "ghostty") {
          (
            terminalRef.current as TerminalFrontend & { options: { fontSize: number } }
          ).options.fontSize = newSize;
        } else {
          (terminalRef.current as XtermInstance).options.fontSize = newSize;
        }
        fitTerminal();
      }
    },
    [fitTerminal, terminalFontSize],
  );

  const handleZoomReset = useCallback(() => {
    useSettingsStore.getState().actions.updateSetting("terminalFontSize", 14);
    if (terminalRef.current) {
      if (activeEngineRef.current === "ghostty") {
        (
          terminalRef.current as TerminalFrontend & { options: { fontSize: number } }
        ).options.fontSize = 14;
      } else {
        (terminalRef.current as XtermInstance).options.fontSize = 14;
      }
      fitTerminal();
    }
  }, [fitTerminal]);

  const getSearchOptions = useCallback((options: TerminalSearchOptions): ISearchOptions => {
    const rootStyles = getComputedStyle(document.documentElement);
    const selected = rootStyles.getPropertyValue("--selected").trim() || "#3b82f6";
    const accent = rootStyles.getPropertyValue("--primary").trim() || "#60a5fa";
    const border = rootStyles.getPropertyValue("--border").trim() || "#4b5563";

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
    terminalRef.current?.clearSelection();
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
        terminalRef.current?.focus();
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
    terminalRef.current?.focus();
  }, [clearSearch]);

  useImperativeHandle(
    getSession(sessionId)?.ref,
    () => ({
      terminal: terminalRef.current,
      searchAddon: addonsRef.current?.searchAddon,
      focus: () => terminalRef.current?.focus(),
      showSearch: () => setIsSearchVisible(true),
      blur: () => terminalRef.current?.blur(),
      clear: () => terminalRef.current?.clear(),
      selectAll: () => terminalRef.current?.selectAll(),
      clearSelection: () => terminalRef.current?.clearSelection(),
      getSelection: () => terminalRef.current?.getSelection() || "",
      paste: (text: string) => terminalRef.current?.paste(text),
      scrollToTop: () => terminalRef.current?.scrollToTop(),
      scrollToBottom: () => terminalRef.current?.scrollToBottom(),
      findNext: (term: string) => addonsRef.current?.searchAddon.findNext(term),
      findPrevious: (term: string) => addonsRef.current?.searchAddon.findPrevious(term),
      serialize: () => (terminalRef.current ? addonsRef.current?.serializeAddon.serialize() : ""),
      resize: () => fitTerminal(),
    }),
    [fitTerminal],
  );

  return (
    <div className="relative flex size-full min-w-0 flex-col overflow-hidden bg-background">
      <TerminalSearch
        isVisible={isSearchVisible}
        onSearch={handleSearch}
        onNext={handleSearchNext}
        onPrevious={handleSearchPrevious}
        onClose={handleSearchClose}
        currentMatch={searchResults.current}
        totalMatches={searchResults.total}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-4">
        <div
          ref={terminalContainerRef}
          id={`terminal-${sessionId}`}
          data-terminal-drop-target
          data-terminal-session-id={sessionId}
          data-terminal-engine={activeEngineRef.current}
          className={`xterm-container flex h-full min-h-0 min-w-0 flex-1 text-foreground ${!isActive ? "opacity-60" : ""}`}
          onDragOver={handleTerminalDragOver}
          onDrop={handleTerminalFileDrop}
          onMouseDown={() => {
            requestAnimationFrame(() => terminalRef.current?.focus());
          }}
        />
      </div>
    </div>
  );
};
