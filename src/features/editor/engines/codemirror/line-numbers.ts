import type { Extension } from "@codemirror/state";
import { gutter, GutterMarker, lineNumbers } from "@codemirror/view";

export interface LineNumberOptions {
  /** The number shown for the first line, for excerpts of a longer file. */
  start?: number;
  /** The number to show for each line, for views stitched from several places. */
  map?: Array<number | null>;
  /** Distances from the cursor line instead of absolute numbers (vim). */
  relative?: boolean;
}

/** The line number gutter, numbering lines from an offset, a map, or relative to the cursor. */
export function athasLineNumbers({ start = 1, map, relative }: LineNumberOptions): Extension {
  if (relative && !map) return relativeLineNumbers();
  if (start === 1 && !map) return lineNumbers();
  return lineNumbers({
    formatNumber: (lineNumber) => {
      const mapped = map?.[lineNumber - 1];
      return String(typeof mapped === "number" ? mapped : start + lineNumber - 1);
    },
  });
}

class LineNumberMarker extends GutterMarker {
  constructor(readonly text: string) {
    super();
  }

  eq(other: LineNumberMarker) {
    return other.text === this.text;
  }

  toDOM() {
    return document.createTextNode(this.text);
  }
}

function relativeLineNumbers(): Extension {
  const widest = (lines: number) => new LineNumberMarker(String(lines));
  return gutter({
    class: "cm-lineNumbers",
    lineMarker: (view, block) => {
      const { doc, selection } = view.state;
      const cursorLine = doc.lineAt(selection.main.head).number;
      const lineNumber = doc.lineAt(block.from).number;
      const distance = Math.abs(lineNumber - cursorLine);
      return new LineNumberMarker(String(distance === 0 ? lineNumber : distance));
    },
    lineMarkerChange: (update) => update.selectionSet || update.docChanged,
    initialSpacer: (view) => widest(view.state.doc.lines),
    updateSpacer: (spacer, update) => (update.docChanged ? widest(update.state.doc.lines) : spacer),
  });
}
