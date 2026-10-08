import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import type { LineSeparator } from "./document-change";
import { fromBufferOffset } from "./position";

interface MatchHighlights {
  /** Ranges as offsets in the buffer's text. */
  matches: ReadonlyArray<{ start: number; end: number }>;
  current?: number;
  separator: LineSeparator;
}

/** Replaces the highlighted search matches drawn by an outside search (diff search, find in files). */
export const setMatchHighlights = StateEffect.define<MatchHighlights>();

const matchMark = Decoration.mark({ class: "cm-athas-match" });
const currentMatchMark = Decoration.mark({ class: "cm-athas-match cm-athas-match-current" });

function buildMatchDecorations(state: EditorState, highlights: MatchHighlights): DecorationSet {
  const { doc } = state;
  const ranges = highlights.matches
    .map((match, index) => {
      const from = fromBufferOffset(doc, match.start, highlights.separator);
      const to = fromBufferOffset(doc, match.end, highlights.separator);
      if (to <= from) return null;
      return (index === highlights.current ? currentMatchMark : matchMark).range(from, to);
    })
    .filter((range) => range !== null);
  return Decoration.set(ranges, true);
}

export const matchHighlightsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setMatchHighlights))
        next = buildMatchDecorations(transaction.state, effect.value);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
