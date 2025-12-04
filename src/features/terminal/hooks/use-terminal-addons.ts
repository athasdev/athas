import { ask } from "@tauri-apps/plugin-dialog";
import { open } from "@tauri-apps/plugin-shell";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

export interface TerminalAddons {
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  webglAddon: WebglAddon;
}

export function createTerminalAddons(terminal: Terminal): TerminalAddons {
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  const unicode11Addon = new Unicode11Addon();
  const clipboardAddon = new ClipboardAddon();
  const webglAddon = new WebglAddon();

  webglAddon.onContextLoss(() => {
    webglAddon.dispose();
  });

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(unicode11Addon);
  terminal.loadAddon(clipboardAddon);
  terminal.loadAddon(webglAddon);

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
