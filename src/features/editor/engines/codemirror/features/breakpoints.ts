import { type Extension, Prec, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { DebugBreakpoint } from "@/features/debugger/types/debugger.types";

import { BREAKPOINT_GUTTER_CLASS } from "../../../config/constants";

type BreakpointKind = "set" | "disabled" | "unverified" | "preview";

class BreakpointMarker extends GutterMarker {
  constructor(
    readonly kind: BreakpointKind,
    readonly label: string,
  ) {
    super();
  }

  eq(other: BreakpointMarker) {
    return other.kind === this.kind && other.label === this.label;
  }

  toDOM() {
    const node = document.createElement("div");
    node.className =
      this.kind === "set"
        ? "cm-athas-breakpoint"
        : `cm-athas-breakpoint cm-athas-breakpoint-${this.kind}`;
    node.title = this.label;
    return node;
  }
}

const previewMarker = new BreakpointMarker("preview", "Add breakpoint");

/** The file's breakpoints as the gutter shows them, zero-based lines. */
export const setBreakpoints = StateEffect.define<readonly DebugBreakpoint[]>();
/** The zero-based line the pointer rests on in the gutter, or null. */
export const setHoveredBreakpointLine = StateEffect.define<number | null>();

/** Breakpoint markers, kept on their lines as text is edited until the store says otherwise. */
const breakpointMarkersField = StateField.define<RangeSet<BreakpointMarker>>({
  create: () => RangeSet.empty,
  update(markers, transaction) {
    let next = markers.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setBreakpoints)) continue;
      const { doc } = transaction.state;
      next = RangeSet.of(
        effect.value
          .filter((breakpoint) => breakpoint.line >= 0 && breakpoint.line < doc.lines)
          .map((breakpoint) => markerFor(breakpoint).range(doc.line(breakpoint.line + 1).from)),
        true,
      );
    }
    return next;
  },
});

const hoveredLineField = StateField.define<number | null>({
  create: () => null,
  update(line, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setHoveredBreakpointLine)) line = effect.value;
    }
    return line;
  },
});

function markerFor(breakpoint: DebugBreakpoint) {
  const kind: BreakpointKind = !breakpoint.enabled
    ? "disabled"
    : breakpoint.verified === false
      ? "unverified"
      : "set";
  return new BreakpointMarker(
    kind,
    breakpoint.message ?? (breakpoint.enabled ? "Breakpoint" : "Disabled breakpoint"),
  );
}

/** Whether a breakpoint marker sits on the zero-based `line`. */
export function hasBreakpointMarker(view: EditorView, line: number) {
  const { doc } = view.state;
  if (line < 0 || line >= doc.lines) return false;
  const from = doc.line(line + 1).from;
  let found = false;
  view.state.field(breakpointMarkersField).between(from, from, () => {
    found = true;
    return false;
  });
  return found;
}

const breakpointTheme = EditorView.baseTheme({
  [`.${BREAKPOINT_GUTTER_CLASS}`]: { cursor: "pointer" },
  [`.${BREAKPOINT_GUTTER_CLASS} .cm-gutterElement`]: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
  },
  ".cm-athas-breakpoint": {
    boxSizing: "border-box",
    width: "10px",
    height: "10px",
    borderRadius: "999px",
    background: "var(--destructive)",
  },
  ".cm-athas-breakpoint-preview": { opacity: "0.45" },
  ".cm-athas-breakpoint-disabled": {
    border: "1px solid var(--muted-foreground)",
    background: "transparent",
  },
  ".cm-athas-breakpoint-unverified": {
    border: "1px solid var(--destructive)",
    background: "transparent",
  },
});

/**
 * The breakpoint gutter, leftmost like a glyph margin: a dot per breakpoint, a faint one where
 * the pointer rests, and a click to toggle through `onToggle` with the zero-based line.
 */
export function breakpointGutter(onToggle: (line: number) => void): Extension {
  return [
    breakpointMarkersField,
    hoveredLineField,
    breakpointTheme,
    Prec.highest(
      gutter({
        class: BREAKPOINT_GUTTER_CLASS,
        markers: (view) => {
          const markers = view.state.field(breakpointMarkersField);
          const hovered = view.state.field(hoveredLineField);
          if (hovered === null || hovered >= view.state.doc.lines) return markers;
          if (hasBreakpointMarker(view, hovered)) return markers;
          return markers.update({
            add: [previewMarker.range(view.state.doc.line(hovered + 1).from)],
          });
        },
        initialSpacer: () => previewMarker,
        domEventHandlers: {
          mousedown(view, line, event) {
            if (!(event instanceof MouseEvent) || event.button !== 0) return false;
            event.preventDefault();
            event.stopPropagation();
            view.dispatch({ effects: setHoveredBreakpointLine.of(null) });
            onToggle(view.state.doc.lineAt(line.from).number - 1);
            return true;
          },
        },
      }),
    ),
  ];
}

/** The zero-based line the pointer is over when it is in the breakpoint or line number gutter. */
export function breakpointHoverLine(view: EditorView, event: MouseEvent): number | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  if (!target.closest(`.${BREAKPOINT_GUTTER_CLASS}, .cm-lineNumbers`)) return null;
  const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
  return view.state.doc.lineAt(block.from).number - 1;
}
