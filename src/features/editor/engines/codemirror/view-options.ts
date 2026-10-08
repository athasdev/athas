import { highlightSelectionMatches } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import {
  drawSelection,
  EditorView,
  highlightTrailingWhitespace,
  highlightWhitespace,
  scrollPastEnd,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { getEditorBottomScrollPadding } from "../../utils/scroll-padding";
import { bracketPairColors } from "./bracket-colors";
import { athasLineNumbers, type LineNumberOptions } from "./line-numbers";
import { athasEditorFont, athasSyntaxHighlighting } from "./theme";

type CursorStyle =
  | "line"
  | "block"
  | "underline"
  | "line-thin"
  | "block-outline"
  | "underline-thin";
type CursorBlinking = "blink" | "smooth" | "phase" | "expand" | "solid";
type RenderWhitespace = "none" | "boundary" | "trailing" | "all";

/** Everything about how the editor looks that comes from settings or the surface it sits in. */
export interface CodeMirrorViewOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontLigatures: boolean;
  italicComments: boolean;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  lineNumberOptions: LineNumberOptions;
  renderWhitespace: RenderWhitespace;
  indentGuides: boolean;
  bracketPairColors: boolean;
  highlightOccurrences: boolean;
  scrollBeyondLastLine: boolean;
  scrollable: boolean;
  cursorStyle: CursorStyle;
  cursorBlinking: CursorBlinking;
}

export function codeMirrorViewExtensions(options: CodeMirrorViewOptions): Extension {
  return [
    athasEditorFont(options.fontFamily, options.fontSize, options.lineHeight),
    EditorView.theme({
      ".cm-content": { fontVariantLigatures: options.fontLigatures ? "normal" : "none" },
    }),
    athasSyntaxHighlighting(options.italicComments),
    EditorState.tabSize.of(options.tabSize),
    indentUnit.of(" ".repeat(options.tabSize)),
    options.wordWrap ? EditorView.lineWrapping : [],
    options.lineNumbers ? athasLineNumbers(options.lineNumberOptions) : [],
    whitespaceExtension(options.renderWhitespace),
    options.indentGuides
      ? indentationMarkers({
          hideFirstIndent: true,
          colors: {
            light: "var(--border)",
            dark: "var(--border)",
            activeLight: "var(--border-strong)",
            activeDark: "var(--border-strong)",
          },
        })
      : [],
    options.bracketPairColors ? bracketPairColors : [],
    options.highlightOccurrences
      ? highlightSelectionMatches({ highlightWordAroundCursor: false })
      : [],
    options.scrollBeyondLastLine ? scrollPastEnd() : bottomScrollPadding,
    options.scrollable ? [] : unscrollable,
    cursorExtension(options.cursorStyle, options.cursorBlinking),
  ];
}

function whitespaceExtension(mode: RenderWhitespace): Extension {
  switch (mode) {
    case "none":
      return [];
    case "trailing":
      return highlightTrailingWhitespace();
    default:
      return highlightWhitespace();
  }
}

/**
 * Room below the last line so it does not sit against the bottom edge, as in Monaco. Kept in step
 * with the editor's height in CodeMirror's measure cycle; reading the height on every update
 * instead forced a layout of the whole window per transaction. Until the first measure, which
 * runs before the editor first paints, the padding is what an editor as tall as the window needs,
 * so a scroll position restored before then is never cut short.
 */
const bottomScrollPadding = ViewPlugin.fromClass(
  class {
    private padding = -1;

    constructor(private readonly view: EditorView) {
      this.apply(
        getEditorBottomScrollPadding(view.dom.ownerDocument.defaultView?.innerHeight ?? 0),
      );
      this.measure(view);
    }

    update(update: ViewUpdate) {
      if (update.geometryChanged) this.measure(update.view);
    }

    private measure(view: EditorView) {
      view.requestMeasure({
        key: this,
        read: (measured) => getEditorBottomScrollPadding(measured.scrollDOM.clientHeight),
        write: (padding) => this.apply(padding),
      });
    }

    private apply(padding: number) {
      if (padding === this.padding) return;
      this.padding = padding;
      this.view.contentDOM.style.paddingBottom = `${padding}px`;
    }

    destroy() {
      this.view.contentDOM.style.paddingBottom = "";
    }
  },
);

/** For editors laid out at full height inside something else that scrolls (diffs, previews). */
const unscrollable = EditorView.theme({
  ".cm-scroller": { overflow: "hidden !important" },
});

const CURSOR_COLOR = "var(--cursor, var(--foreground))";

const cursorStyles: Record<CursorStyle, Record<string, string>> = {
  line: { borderLeftWidth: "2px" },
  "line-thin": { borderLeftWidth: "1px" },
  block: {
    borderLeft: "none",
    width: "1ch",
    backgroundColor: `color-mix(in srgb, ${CURSOR_COLOR} 55%, transparent)`,
  },
  "block-outline": { borderLeft: "none", width: "1ch", outline: `1px solid ${CURSOR_COLOR}` },
  underline: { borderLeft: "none", width: "1ch", borderBottom: `2px solid ${CURSOR_COLOR}` },
  "underline-thin": { borderLeft: "none", width: "1ch", borderBottom: `1px solid ${CURSOR_COLOR}` },
};

function cursorExtension(style: CursorStyle, blinking: CursorBlinking): Extension {
  return [
    drawSelection({ cursorBlinkRate: blinking === "solid" ? 0 : 1200 }),
    EditorView.theme({ ".cm-cursor, .cm-dropCursor": cursorStyles[style] }),
  ];
}
