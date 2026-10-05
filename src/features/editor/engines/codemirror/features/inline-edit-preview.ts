import { highlightingFor, language } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutterLineClass,
  WidgetType,
} from "@codemirror/view";
import { highlightCode, type Highlighter } from "@lezer/highlight";
import type { InlineEditPreview } from "../../../inline-edit/inline-edit-preview";
import type { Range } from "../../../types/editor.types";
import type { LineSeparator } from "../document-change";
import { fromBufferOffset } from "../position";
import { revealRangeInCenterIfOutside } from "./reveal";

interface PreviewState {
  /** Which preview this is, so a stale cleanup does not clear a newer one; 0 for none. */
  id: number;
  decorations: DecorationSet;
  gutter: RangeSet<GutterMarker>;
}

const EMPTY_PREVIEW: PreviewState = { id: 0, decorations: Decoration.none, gutter: RangeSet.empty };
let nextPreviewId = 1;

const setInlineEditPreview = StateEffect.define<PreviewState>();

class RemovedLineGutterMarker extends GutterMarker {
  elementClass = "cm-inline-edit-preview-removed-glyph";
}

const removedLineGutterMarker = new RemovedLineGutterMarker();

/** The lines the proposal would leave, syntax highlighted the way the editor colors its text. */
class ProposedLinesWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: ProposedLinesWidget) {
    return other.text === this.text;
  }

  get estimatedHeight() {
    return -1;
  }

  toDOM(view: EditorView) {
    const node = document.createElement("div");
    node.className = "cm-inline-edit-preview-added";
    node.setAttribute("aria-label", "Proposed edit");
    for (const line of highlightLines(this.text, view.state)) {
      const row = document.createElement("div");
      row.className = "cm-inline-edit-preview-line";
      if (line.length === 0) row.textContent = " ";
      for (const token of line) {
        if (!token.className) {
          row.append(token.text);
          continue;
        }
        const span = document.createElement("span");
        span.className = token.className;
        span.textContent = token.text;
        row.append(span);
      }
      node.append(row);
    }
    return node;
  }
}

type HighlightedLine = Array<{ text: string; className: string }>;

/** Splits `text` into lines of tokens carrying the classes the editor's highlighters give them. */
function highlightLines(text: string, state: EditorState): HighlightedLine[] {
  const lines: HighlightedLine[] = [[]];
  const lang = state.facet(language);
  if (!lang) {
    return text.split("\n").map((line) => (line ? [{ text: line, className: "" }] : []));
  }
  const highlighter: Highlighter = { style: (tags) => highlightingFor(state, tags) };
  try {
    highlightCode(
      text,
      lang.parser.parse(text),
      highlighter,
      (code, className) => lines[lines.length - 1].push({ text: code, className }),
      () => lines.push([]),
    );
  } catch {
    return text.split("\n").map((line) => (line ? [{ text: line, className: "" }] : []));
  }
  return lines;
}

const inlineEditPreviewField = StateField.define<PreviewState>({
  create: () => EMPTY_PREVIEW,
  update(value, transaction) {
    let next = transaction.docChanged
      ? {
          id: value.id,
          decorations: value.decorations.map(transaction.changes),
          gutter: value.gutter.map(transaction.changes),
        }
      : value;
    for (const effect of transaction.effects) {
      if (effect.is(setInlineEditPreview)) next = effect.value;
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    gutterLineClass.from(field, (value) => value.gutter),
  ],
});

const inlineEditPreviewTheme = EditorView.baseTheme({
  ".cm-inline-edit-preview-removed": { backgroundColor: "var(--git-deleted-soft)" },
  ".cm-gutter:last-child .cm-gutterElement.cm-inline-edit-preview-removed-glyph": {
    boxShadow: "inset -2px 0 0 var(--git-deleted)",
  },
  ".cm-inline-edit-preview-added": {
    overflow: "hidden",
    backgroundColor: "var(--git-added-soft)",
    boxShadow: "inset 2px 0 0 var(--git-added)",
    whiteSpace: "pre",
    pointerEvents: "none",
  },
});

/** The state the inline edit preview needs; installed on first use when a caller has not. */
export const inlineEditPreviewExtension: Extension = [
  inlineEditPreviewField,
  inlineEditPreviewTheme,
];

function ensureInstalled(view: EditorView) {
  if (view.state.field(inlineEditPreviewField, false) !== undefined) return;
  view.dispatch({ effects: StateEffect.appendConfig.of(inlineEditPreviewExtension) });
}

/**
 * Shows a proposed inline edit as a diff: the affected lines are tinted as removed and the
 * resulting lines render in a block underneath. Returns a function that removes both.
 */
export function showCodeMirrorInlineEditPreview(
  view: EditorView,
  preview: InlineEditPreview,
  separator: LineSeparator,
): () => void {
  ensureInstalled(view);
  const { doc } = view.state;
  const from = fromBufferOffset(doc, preview.startOffset, separator);
  const to = Math.max(from, fromBufferOffset(doc, preview.endOffset, separator));
  const firstLine = doc.lineAt(from);
  const lastLine = doc.lineAt(to);
  const resultText = `${doc.sliceString(firstLine.from, from)}${preview.editedText.replace(
    /\r\n?/g,
    "\n",
  )}${doc.sliceString(to, lastLine.to)}`;
  const resultLineCount = resultText.split("\n").length;

  const lineDecoration = Decoration.line({ class: "cm-inline-edit-preview-removed" });
  const decorations = [];
  const gutter = [];
  for (let number = firstLine.number; number <= lastLine.number; number++) {
    const line = doc.line(number);
    decorations.push(lineDecoration.range(line.from));
    gutter.push(removedLineGutterMarker.range(line.from));
  }
  decorations.push(
    Decoration.widget({
      widget: new ProposedLinesWidget(resultText),
      block: true,
      side: 1,
    }).range(lastLine.to),
  );
  const id = nextPreviewId++;
  const state: PreviewState = {
    id,
    decorations: Decoration.set(decorations),
    gutter: RangeSet.of(gutter),
  };
  view.dispatch({ effects: setInlineEditPreview.of(state) });
  if (preview.reveal) {
    revealRangeInCenterIfOutside(
      view,
      firstLine.from,
      lastLine.to,
      resultLineCount * view.defaultLineHeight,
    );
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (view.state.field(inlineEditPreviewField, false)?.id !== id) return;
    view.dispatch({ effects: setInlineEditPreview.of(EMPTY_PREVIEW) });
  };
}

/**
 * Replaces `range` with `editedText` in one transaction and puts the cursor after it, scrolling
 * there when it is out of view. The editor forwards the change to the buffer like any typing.
 */
export function applyCodeMirrorInlineEdit(
  view: EditorView,
  edit: { range: Range; editedText: string },
  separator: LineSeparator,
) {
  const { doc } = view.state;
  const from = fromBufferOffset(doc, edit.range.start.offset, separator);
  const to = Math.max(from, fromBufferOffset(doc, edit.range.end.offset, separator));
  const insert = view.state.toText(edit.editedText);
  const cursor = from + insert.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor },
    userEvent: "input.inline-edit",
  });
  revealRangeInCenterIfOutside(view, cursor);
}
