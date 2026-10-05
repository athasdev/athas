import type { Extension } from "@codemirror/state";
import {
  activateHover,
  closeHoverTooltips,
  hasHoverTooltips,
  hoverTooltip,
  type HoverTooltipSource,
  keymap,
} from "@codemirror/view";
import { useEffect, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { formatHoverContents } from "@/features/editor/lsp/hover-content";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import { fromLspRange, isLspFile, toLspPosition } from "../lsp/lsp-positions";
import { createMarkdownElement } from "../lsp/markdown-content";

const HOVER_MIN_WIDTH = 120;
const HOVER_MAX_WIDTH = 500;
const HOVER_MIN_HEIGHT = 48;

/** The largest hover that still fits inside the editor, as Monaco clamped its hover widget. */
export function getHoverBounds(container: HTMLElement) {
  const margin = EDITOR_CONSTANTS.HOVER_TOOLTIP_MARGIN;
  const width = Math.max(HOVER_MIN_WIDTH, container.clientWidth - margin * 2);
  const height = Math.max(HOVER_MIN_HEIGHT, container.clientHeight - margin * 2);
  return {
    maxWidth: Math.min(HOVER_MAX_WIDTH, width),
    maxHeight: Math.min(EDITOR_CONSTANTS.HOVER_TOOLTIP_HEIGHT, height),
  };
}

/** A hover card for rendered markdown, sized to fit the editor it belongs to. */
export function createHoverElement(markdown: string, container: HTMLElement) {
  const element = createMarkdownElement(markdown, "cm-athas-hover");
  const { maxWidth, maxHeight } = getHoverBounds(container);
  element.style.setProperty("--athas-hover-max-width", `${maxWidth}px`);
  element.style.setProperty("--athas-hover-max-height", `${maxHeight}px`);
  return element;
}

interface HoverClient {
  getHover: LspClient["getHover"];
}

/** The hover source: the language server's hover for the hovered position, as markdown. */
export function lspHoverSource(
  filePath: string,
  container: HTMLElement,
  client: HoverClient = LspClient.getInstance(),
): HoverTooltipSource {
  return async (view, position) => {
    if (!isLspFile(filePath)) return null;
    const doc = view.state.doc;
    const lspPosition = toLspPosition(doc, position);
    const hover = await client.getHover(filePath, lspPosition.line, lspPosition.character);
    if (!hover?.contents || view.state.doc !== doc) return null;
    const markdown = formatHoverContents(hover.contents);
    if (!markdown) return null;
    const range = hover.range
      ? fromLspRange(doc, hover.range)
      : (view.state.wordAt(position) ?? { from: position, to: position });
    return {
      pos: range.from,
      end: range.to,
      above: true,
      create: () => ({ dom: createHoverElement(markdown, container) }),
    };
  };
}

function lspHoverExtension(filePath: string, container: HTMLElement): Extension {
  return [
    hoverTooltip(lspHoverSource(filePath, container), {
      hoverTime: EDITOR_CONSTANTS.HOVER_TOOLTIP_DELAY,
    }),
    keymap.of([
      {
        key: "Escape",
        run: (view) => {
          if (!hasHoverTooltips(view.state)) return false;
          view.dispatch({ effects: closeHoverTooltips });
          return true;
        },
      },
    ]),
  ];
}

/** Language server hover, plus the `editor-show-hover` command showing it at the cursor. */
export function LspHover({ host }: { host: CodeMirrorHost }) {
  const { view, filePath, container, isActiveSurface } = host;
  const extension = useMemo(() => lspHoverExtension(filePath, container), [container, filePath]);
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    if (!isActiveSurface) return;
    const handleShowHover = () => {
      view.focus();
      activateHover(view, view.state.selection.main.head, 1, {
        until: (tr) => tr.docChanged || tr.selection !== undefined,
      });
    };
    window.addEventListener("editor-show-hover", handleShowHover);
    return () => window.removeEventListener("editor-show-hover", handleShowHover);
  }, [isActiveSurface, view]);

  return null;
}
