import { type Range, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { fromLspPosition } from "./lsp-document";

interface LspInlayHint {
  line: number;
  character: number;
  label: string;
  kind?: string;
  paddingLeft: boolean;
  paddingRight: boolean;
}

class InlayHintWidget extends WidgetType {
  constructor(readonly hint: LspInlayHint) {
    super();
  }

  eq(other: InlayHintWidget) {
    return (
      other.hint.label === this.hint.label &&
      other.hint.kind === this.hint.kind &&
      other.hint.paddingLeft === this.hint.paddingLeft &&
      other.hint.paddingRight === this.hint.paddingRight
    );
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-athas-inlay-hint";
    if (this.hint.kind) element.dataset.kind = this.hint.kind.toLowerCase();
    if (this.hint.paddingLeft) element.dataset.paddingLeft = "";
    if (this.hint.paddingRight) element.dataset.paddingRight = "";
    element.textContent = this.hint.label;
    element.setAttribute("aria-hidden", "true");
    return element;
  }
}

/** Inline decorations for the server's inlay hints, placed against the current document. */
export function inlayHintDecorations(doc: Text, hints: readonly LspInlayHint[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const hint of hints) {
    if (!hint.label || hint.line < 0 || hint.line >= doc.lines) continue;
    const position = fromLspPosition(doc, hint);
    ranges.push(Decoration.widget({ widget: new InlayHintWidget(hint), side: 1 }).range(position));
  }
  return Decoration.set(ranges, true);
}

export const setInlayHints = StateEffect.define<DecorationSet>();

export const inlayHintsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(hints, tr) {
    for (const effect of tr.effects) if (effect.is(setInlayHints)) return effect.value;
    return hints.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
