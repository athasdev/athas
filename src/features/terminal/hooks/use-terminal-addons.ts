import { ask } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import { ClipboardAddon, type ClipboardSelectionType } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import {
  parseTerminalFileLinks,
  type TerminalFileLink,
} from "@/features/terminal/utils/terminal-file-links";
import { writeClipboardText } from "@/utils/clipboard";

export interface TerminalAddons {
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  webglAddon: WebglAddon | null;
}

export interface CreateTerminalAddonsOptions {
  onRendererFallback?: () => void;
}

export function createTerminalAddons(
  terminal: Terminal,
  options: CreateTerminalAddonsOptions = {},
): TerminalAddons {
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  const unicode11Addon = new Unicode11Addon();
  const clipboardAddon = new ClipboardAddon(undefined, {
    readText: async () => "",
    writeText: async (selection: ClipboardSelectionType, text: string) => {
      if (selection === "c") await writeClipboardText(text);
    },
  });

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(unicode11Addon);
  terminal.loadAddon(clipboardAddon);

  const webglAddon = loadWebglRenderer(terminal, options.onRendererFallback);

  return { fitAddon, searchAddon, serializeAddon, webglAddon };
}

export function loadWebglRenderer(
  terminal: Terminal,
  onRendererFallback?: () => void,
): WebglAddon | null {
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      onRendererFallback?.();
    });
    terminal.loadAddon(webglAddon);
    return webglAddon;
  } catch (error) {
    console.warn("WebGL terminal renderer unavailable; using the DOM renderer.", error);
    onRendererFallback?.();
    return null;
  }
}

export function loadWebLinksAddon(terminal: Terminal): void {
  const webLinksAddon = new WebLinksAddon(async (_event: MouseEvent, uri: string) => {
    try {
      const confirmed = await ask(`Do you want to open this link in your browser?\n\n${uri}`, {
        title: "Open External Link",
        kind: "warning",
        okLabel: "Open",
        cancelLabel: "Cancel",
      });

      if (confirmed) {
        await open(uri);
      }
    } catch (error) {
      console.error("Failed to open link:", error);
    }
  });
  terminal.loadAddon(webLinksAddon);
}

interface FileLinksProviderOptions {
  getWorkspaceRoot: () => string | undefined;
  openFile: (link: TerminalFileLink) => void | Promise<void>;
}

export function registerFileLinksProvider(
  terminal: Terminal,
  options: FileLinksProviderOptions,
): void {
  const provider: ILinkProvider = {
    provideLinks: (bufferLineNumber, callback) => {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const links = parseTerminalFileLinks(
        line.translateToString(true),
        options.getWorkspaceRoot(),
      );
      if (links.length === 0) {
        callback(undefined);
        return;
      }

      callback(
        links.map<ILink>((link) => ({
          range: {
            start: { x: link.startIndex + 1, y: bufferLineNumber },
            end: { x: link.endIndex, y: bufferLineNumber },
          },
          text: link.text,
          activate: () => {
            void options.openFile(link);
          },
        })),
      );
    },
  };

  terminal.registerLinkProvider(provider);
}

export function injectLinkStyles(sessionId: string, containerId: string): void {
  const styleId = `terminal-link-style-${sessionId}`;
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-accent")
    .trim();

  style.textContent = `
    #${containerId} .xterm-screen a,
    #${containerId} .xterm-link,
    #${containerId} [style*="text-decoration"] {
      color: ${accentColor} !important;
      text-decoration: underline !important;
      cursor: pointer !important;
    }
    #${containerId} .xterm-screen a:hover,
    #${containerId} .xterm-link:hover {
      opacity: 0.8 !important;
    }
  `;
  document.head.appendChild(style);
}

export function removeLinkStyles(sessionId: string): void {
  const styleId = `terminal-link-style-${sessionId}`;
  const style = document.getElementById(styleId);
  if (style) {
    style.remove();
  }
}
