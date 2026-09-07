import { open } from "@tauri-apps/plugin-shell";
import { ClipboardAddon, type ClipboardSelectionType } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { ProgressAddon } from "@xterm/addon-progress";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ILink, ILinkHandler, ILinkProvider, Terminal } from "@xterm/xterm";
import type { TerminalLinkTooltip } from "@/features/terminal/lib/terminal-link-tooltip";
import {
  parseTerminalFileLinks,
  type TerminalFileLink,
} from "@/features/terminal/utils/terminal-file-links";
import {
  describeTerminalLinkHint,
  isTerminalLinkModifierPressed,
  resolveExternalLinkTarget,
} from "@/features/terminal/utils/terminal-link-activation";
import { recordFrictionSignal } from "@/features/telemetry/services/telemetry";
import { writeClipboardText } from "@/utils/clipboard";
import { frontendTrace } from "@/utils/frontend-trace";

export interface TerminalAddons {
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  serializeAddon: SerializeAddon;
  progressAddon: ProgressAddon;
  imageAddon: ImageAddon | null;
  webglAddon: WebglAddon | null;
}

export const TERMINAL_UNICODE_VERSION = "15-graphemes";

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
  const unicodeAddon = new UnicodeGraphemesAddon();
  const progressAddon = new ProgressAddon();
  const clipboardAddon = new ClipboardAddon(undefined, {
    readText: async () => "",
    writeText: async (selection: ClipboardSelectionType, text: string) => {
      if (selection === "c") await writeClipboardText(text);
    },
  });

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(unicodeAddon);
  terminal.loadAddon(clipboardAddon);
  terminal.loadAddon(progressAddon);
  terminal.unicode.activeVersion = TERMINAL_UNICODE_VERSION;

  const imageAddon = loadImageAddon(terminal);
  const webglAddon = loadWebglRenderer(terminal, options.onRendererFallback);

  return { fitAddon, searchAddon, serializeAddon, progressAddon, imageAddon, webglAddon };
}

function loadImageAddon(terminal: Terminal): ImageAddon | null {
  try {
    const imageAddon = new ImageAddon({
      sixelSupport: true,
      iipSupport: true,
      showPlaceholder: true,
      enableSizeReports: true,
    });
    terminal.loadAddon(imageAddon);
    return imageAddon;
  } catch (error) {
    console.warn("Inline terminal images are unavailable in this session.", error);
    return null;
  }
}

export function loadWebglRenderer(
  terminal: Terminal,
  onRendererFallback?: () => void,
): WebglAddon | null {
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      reportRendererFallback("context-loss");
      onRendererFallback?.();
    });
    terminal.loadAddon(webglAddon);
    return webglAddon;
  } catch (error) {
    console.warn("WebGL terminal renderer unavailable; using the DOM renderer.", error);
    reportRendererFallback("unavailable", error);
    onRendererFallback?.();
    return null;
  }
}

function reportRendererFallback(reason: "unavailable" | "context-loss", error?: unknown) {
  frontendTrace("warn", "terminal:renderer", `webgl-${reason}`, {
    error: error instanceof Error ? error.message : error ? String(error) : null,
  });
  void recordFrictionSignal({ area: "terminal", signal: "renderer_fallback" });
}

export function openExternalTerminalLink(uri: string): void {
  const target = resolveExternalLinkTarget(uri);
  if (!target) return;
  open(target).catch((error) => console.error("Failed to open link:", error));
}

interface TerminalLinkOptions {
  tooltip: TerminalLinkTooltip;
}

export function loadWebLinksAddon(terminal: Terminal, { tooltip }: TerminalLinkOptions): void {
  const webLinksAddon = new WebLinksAddon(
    (event: MouseEvent, uri: string) => {
      if (!isTerminalLinkModifierPressed(event)) return;
      openExternalTerminalLink(uri);
    },
    {
      hover: (event, text) => tooltip.show(event, text, describeTerminalLinkHint("url")),
      leave: () => tooltip.hide(),
    },
  );
  terminal.loadAddon(webLinksAddon);
}

interface FileLinksProviderOptions extends TerminalLinkOptions {
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
          activate: (event) => {
            if (!isTerminalLinkModifierPressed(event)) return;
            void options.openFile(link);
          },
          hover: (event, text) =>
            options.tooltip.show(event, text, describeTerminalLinkHint("file")),
          leave: () => options.tooltip.hide(),
        })),
      );
    },
  };

  terminal.registerLinkProvider(provider);
}

export function createTerminalLinkHandler(options: FileLinksProviderOptions): ILinkHandler {
  const resolveFileLink = (uri: string) =>
    uri.toLowerCase().startsWith("file://")
      ? (parseTerminalFileLinks(uri, options.getWorkspaceRoot())[0] ?? null)
      : null;

  return {
    allowNonHttpProtocols: true,
    activate: (event, uri) => {
      if (!isTerminalLinkModifierPressed(event)) return;
      const fileLink = resolveFileLink(uri);
      if (fileLink) {
        void options.openFile(fileLink);
        return;
      }
      openExternalTerminalLink(uri);
    },
    hover: (event, uri) => {
      const fileLink = resolveFileLink(uri);
      const isExternal = !fileLink && resolveExternalLinkTarget(uri) !== null;
      if (!fileLink && !isExternal) return;
      options.tooltip.show(
        event,
        fileLink ? fileLink.path : uri,
        describeTerminalLinkHint(fileLink ? "file" : "url"),
      );
    },
    leave: () => options.tooltip.hide(),
  };
}

export function injectLinkStyles(sessionId: string, containerId: string): void {
  const styleId = `terminal-link-style-${sessionId}`;
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
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
