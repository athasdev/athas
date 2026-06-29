import { ask } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
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

export interface TerminalAddons {
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  webglAddon: WebglAddon | null;
}

export interface CreateTerminalAddonsOptions {
  /** Skip WebGL addon - use canvas renderer instead (better for some fonts like Nerd Fonts) */
  skipWebGL?: boolean;
}

export function createTerminalAddons(
  terminal: Terminal,
  options: CreateTerminalAddonsOptions = {},
): TerminalAddons {
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  const unicode11Addon = new Unicode11Addon();

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(unicode11Addon);

  let webglAddon: WebglAddon | null = null;

  if (!options.skipWebGL) {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon?.dispose();
    });
    terminal.loadAddon(webglAddon);
  }

  return { fitAddon, searchAddon, serializeAddon, webglAddon };
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
