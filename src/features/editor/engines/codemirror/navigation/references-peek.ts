import { Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

/** Renders the peek's content into its element and returns how to tear it down again. */
export type MountReferencesPeek = (element: HTMLElement, view: EditorView) => () => void;

interface ReferencesPeek {
  id: number;
  /** A position on the line the peek opens under, mapped through edits. */
  anchor: number;
  mount: MountReferencesPeek;
  /** Height in editor lines. */
  lines: number;
}

let nextPeekId = 1;

export const openReferencesPeekEffect = StateEffect.define<Omit<ReferencesPeek, "id">>();
export const closeReferencesPeekEffect = StateEffect.define<null>();

const cleanups = new WeakMap<HTMLElement, () => void>();

class ReferencesPeekWidget extends WidgetType {
  constructor(readonly peek: ReferencesPeek) {
    super();
  }

  eq(other: ReferencesPeekWidget) {
    return other.peek.id === this.peek.id;
  }

  get estimatedHeight() {
    return -1;
  }

  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-athas-references-peek";
    element.style.height = `${Math.round(view.defaultLineHeight * this.peek.lines)}px`;
    sizePeekToViewport(view, element);
    cleanups.set(element, this.peek.mount(element, view));
    return element;
  }

  destroy(element: HTMLElement) {
    cleanups.get(element)?.();
    cleanups.delete(element);
  }

  ignoreEvent() {
    return true;
  }
}

/** Keeps the peek as wide as the visible text area and pinned there when the text scrolls sideways. */
function sizePeekToViewport(view: EditorView, element: HTMLElement) {
  view.requestMeasure({
    read: () => {
      const gutters = view.dom.querySelector<HTMLElement>(".cm-gutters");
      const gutterWidth = gutters?.offsetWidth ?? 0;
      return { gutterWidth, width: Math.max(0, view.scrollDOM.clientWidth - gutterWidth) };
    },
    write: ({ gutterWidth, width }) => {
      element.style.left = `${gutterWidth}px`;
      element.style.width = width > 0 ? `${width}px` : "";
    },
  });
}

export const referencesPeekField = StateField.define<ReferencesPeek | null>({
  create: () => null,
  update(peek, tr) {
    let next = peek;
    if (next && tr.docChanged) next = { ...next, anchor: tr.changes.mapPos(next.anchor) };
    for (const effect of tr.effects) {
      if (effect.is(openReferencesPeekEffect)) next = { ...effect.value, id: nextPeekId++ };
      else if (effect.is(closeReferencesPeekEffect)) next = null;
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state): DecorationSet => {
      const peek = state.field(field);
      if (!peek) return Decoration.none;
      const at = state.doc.lineAt(Math.min(peek.anchor, state.doc.length)).to;
      return Decoration.set([
        Decoration.widget({ widget: new ReferencesPeekWidget(peek), block: true, side: 1 }).range(
          at,
        ),
      ]);
    }),
});

/** Closes the peek in a view, handing focus back to its text. */
export function closeReferencesPeek(view: EditorView): boolean {
  if (!view.state.field(referencesPeekField, false)) return false;
  view.dispatch({ effects: closeReferencesPeekEffect.of(null) });
  view.focus();
  return true;
}

/** Opens the peek under the line holding `position`, replacing one already open. */
export function openReferencesPeek(
  view: EditorView,
  position: number,
  mount: MountReferencesPeek,
  lines = 14,
) {
  const anchor = view.state.doc.lineAt(position).to;
  view.dispatch({
    effects: [
      openReferencesPeekEffect.of({ anchor, mount, lines }),
      EditorView.scrollIntoView(anchor, { y: "nearest", yMargin: view.defaultLineHeight * lines }),
    ],
  });
}

const resizePeek = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      if (!update.geometryChanged) return;
      for (const element of update.view.dom.querySelectorAll<HTMLElement>(
        ".cm-athas-references-peek",
      )) {
        sizePeekToViewport(update.view, element);
      }
    }
  },
);

export const referencesPeek = [
  referencesPeekField,
  resizePeek,
  Prec.high(keymap.of([{ key: "Escape", run: closeReferencesPeek }])),
];
