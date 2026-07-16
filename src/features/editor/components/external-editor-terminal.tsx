import { invoke } from "@tauri-apps/api/core";
import { ClipboardAddon, type ClipboardSelectionType } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useTerminalTheme } from "@/features/terminal/hooks/use-terminal-theme";
import { loadWebglRenderer } from "@/features/terminal/hooks/use-terminal-addons";
import { useTerminalWriteBuffer } from "@/features/terminal/hooks/use-terminal-write-buffer";
import type { TerminalSize } from "@/features/terminal/types/terminal.types";
import { buildTerminalFontFamily } from "@/features/terminal/utils/resolve-font";
import { getTerminalKeyAction } from "@/features/terminal/utils/terminal-keyboard";
import { getTerminalCompatibilityOptions } from "@/features/terminal/utils/terminal-options";
import {
  getTerminalOutputFlowAction,
  getTerminalSize,
  releaseTerminalEventChannel,
  subscribeToTerminalEvents,
  terminalSizesEqual,
} from "@/features/terminal/utils/terminal-protocol";
import { useProjectStore } from "@/features/window/stores/project.store";
import { readClipboardText, writeClipboardText } from "@/utils/clipboard";
import { cn } from "@/utils/cn";
import { currentPlatform } from "@/utils/platform";
import "@xterm/xterm/css/xterm.css";
import "@/features/terminal/styles/terminal.css";

interface ExternalEditorTerminalProps {
  filePath: string;
  fileName: string;
  terminalConnectionId: string;
  onEditorExit?: () => void;
}

function sanitizeTerminalTitle(rawTitle: string): string {
  let result = "";

  for (const char of rawTitle) {
    const code = char.charCodeAt(0);

    if ((code >= 0 && code <= 31) || code === 127 || code === 155) {
      continue;
    }

    result += char;
  }

  return result.trim();
}

export const ExternalEditorTerminal = ({
  filePath,
  fileName,
  terminalConnectionId,
  onEditorExit,
}: ExternalEditorTerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isInitializingRef = useRef(false);
  const hasExecutedCommandRef = useRef(false);
  const resizeRafRef = useRef<number | null>(null);
  const lastSizeRef = useRef<TerminalSize | null>(null);
  const queuedOutputBytesRef = useRef(0);
  const outputPausedRef = useRef(false);

  const { fontSize: editorFontSize, fontFamily: editorFontFamily } = useEditorSettingsStore();
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const editorEngine = useSettingsStore((state) => state.settings.editorEngine);
  const customEditorCommand = useSettingsStore((state) => state.settings.customEditorCommand);
  const theme = useSettingsStore((state) => state.settings.theme);
  const { getTerminalTheme } = useTerminalTheme();
  const { write, writeBinary, flush } = useTerminalWriteBuffer({
    getConnectionId: () => terminalConnectionId,
    writeChunk: async (connectionId, input) => {
      await invoke("terminal_write", { id: connectionId, input });
    },
  });

  const scheduleFit = useCallback(() => {
    if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);

    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null;
      const terminal = xtermRef.current;
      const fitAddon = fitAddonRef.current;
      const container = terminalRef.current;
      if (!terminal || !fitAddon || !container || container.offsetParent === null) return;

      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      fitAddon.fit();
      const size = getTerminalSize(terminal);
      if (terminalSizesEqual(lastSizeRef.current, size)) return;
      lastSizeRef.current = size;
      void invoke("terminal_resize", { id: terminalConnectionId, size }).catch((error) => {
        lastSizeRef.current = null;
        console.error("Failed to resize terminal:", error);
      });
      terminal.refresh(0, terminal.rows - 1);
    });
  }, [terminalConnectionId]);

  const updateExternalEditorBufferTitle = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!trimmed || trimmed === "Default Terminal") return;

      const buffers = useBufferStore.getState().buffers;
      const buffer = buffers.find(
        (item) =>
          item.type === "externalEditor" && item.terminalConnectionId === terminalConnectionId,
      );

      if (!buffer || buffer.name === trimmed) return;

      useBufferStore.getState().actions.updateBuffer({
        ...buffer,
        name: trimmed,
      });
    },
    [terminalConnectionId],
  );

  const getEditorCommand = useCallback(
    (path: string): string => {
      const relativePath = rootFolderPath ? path.replace(rootFolderPath, ".") : path;

      switch (editorEngine) {
        case "nvim":
          return `nvim "${relativePath}"`;
        case "helix":
          return `hx "${relativePath}"`;
        case "vim":
          return `vim "${relativePath}"`;
        case "custom":
          return customEditorCommand.replace("$FILE", `"${relativePath}"`);
        default:
          return `nvim "${relativePath}"`;
      }
    },
    [editorEngine, customEditorCommand, rootFolderPath],
  );

  const initializeTerminal = useCallback(() => {
    if (!terminalRef.current || xtermRef.current || isInitializingRef.current) {
      return;
    }

    isInitializingRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: editorFontSize,
      fontFamily: buildTerminalFontFamily(editorFontFamily),
      theme: getTerminalTheme(),
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: false,
      macOptionIsMeta: false,
      rightClickSelectsWord: false,
      ...getTerminalCompatibilityOptions(),
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const unicodeAddon = new Unicode11Addon();
    const clipboardAddon = new ClipboardAddon(undefined, {
      readText: async () => "",
      writeText: async (selection: ClipboardSelectionType, text: string) => {
        if (selection === "c") await writeClipboardText(text);
      },
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicodeAddon);
    terminal.loadAddon(clipboardAddon);

    terminal.unicode.activeVersion = "11";

    terminal.open(terminalRef.current);
    loadWebglRenderer(terminal, scheduleFit);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    scheduleFit();

    terminal.onData(write);
    terminal.onBinary((data) => {
      writeBinary(Array.from(data, (character) => character.charCodeAt(0) & 0xff));
    });

    terminal.onTitleChange((rawTitle) => {
      const title = sanitizeTerminalTitle(rawTitle);

      if (!title || title === fileName) return;
      updateExternalEditorBufferTitle(title);
    });

    terminal.attachCustomKeyEventHandler((event) => {
      const action = getTerminalKeyAction(event, currentPlatform);
      if (action.type === "write") {
        event.preventDefault();
        write(action.data);
        return false;
      }
      if (action.type === "switchTab") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("terminal-switch-tab", { detail: action.direction }));
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
          .then((text) => terminal.paste(text))
          .catch((error) => console.error("Failed to paste into terminal:", error));
        return false;
      }
      return action.type === "passthrough";
    });

    const setOutputPaused = (paused: boolean) => {
      if (outputPausedRef.current === paused) return;
      outputPausedRef.current = paused;
      void invoke("terminal_set_paused", { id: terminalConnectionId, paused }).catch(() => {
        outputPausedRef.current = !paused;
      });
    };

    const unsubscribeEvents = subscribeToTerminalEvents(terminalConnectionId, (event) => {
      if (event.event === "output") {
        const bytes = Uint8Array.from(event.data);
        queuedOutputBytesRef.current += bytes.byteLength;
        if (
          getTerminalOutputFlowAction(queuedOutputBytesRef.current, outputPausedRef.current) ===
          "pause"
        ) {
          setOutputPaused(true);
        }
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
        console.error("Terminal error:", event.message);
        return;
      }

      if (event.event === "closed") {
        releaseTerminalEventChannel(terminalConnectionId);
        onEditorExit?.();
      }
    });

    (terminal as unknown as { _cleanupListeners: () => void })._cleanupListeners = () => {
      if (outputPausedRef.current) setOutputPaused(false);
      unsubscribeEvents();
    };

    isInitializingRef.current = false;

    terminal.focus();

    if (!hasExecutedCommandRef.current) {
      hasExecutedCommandRef.current = true;
      const command = getEditorCommand(filePath);
      setTimeout(() => {
        write(`${command}\n`);
      }, 200);
    }
  }, [
    editorFontSize,
    editorFontFamily,
    getTerminalTheme,
    terminalConnectionId,
    filePath,
    fileName,
    getEditorCommand,
    onEditorExit,
    scheduleFit,
    updateExternalEditorBufferTitle,
    write,
    writeBinary,
  ]);

  useEffect(() => {
    initializeTerminal();

    return () => {
      void flush();
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
  }, [flush, initializeTerminal]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = editorFontSize;
      scheduleFit();
    }
  }, [editorFontSize, scheduleFit]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontFamily = buildTerminalFontFamily(editorFontFamily);
      scheduleFit();
    }
  }, [editorFontFamily, scheduleFit]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getTerminalTheme();
      scheduleFit();
    }
  }, [theme, getTerminalTheme, scheduleFit]);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(scheduleFit);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", scheduleFit);
    visualViewport?.addEventListener("resize", scheduleFit);
    document.fonts.addEventListener("loadingdone", scheduleFit);
    void document.fonts.ready.then(scheduleFit);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleFit);
      visualViewport?.removeEventListener("resize", scheduleFit);
      document.fonts.removeEventListener("loadingdone", scheduleFit);
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, [scheduleFit]);

  return (
    <div className="flex size-full flex-col bg-primary-bg">
      <div
        ref={terminalRef}
        className={cn("xterm-container size-full flex-1", "focus:outline-none")}
        style={{ padding: "8px" }}
      />
    </div>
  );
};
