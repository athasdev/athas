import { countColumn, type Range, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export interface LspCodeLens {
  line: number;
  title: string;
  command?: string;
  arguments?: unknown[];
}

type RunCodeLens = (lens: LspCodeLens, view: EditorView) => void;

class CodeLensWidget extends WidgetType {
  constructor(
    readonly lenses: readonly LspCodeLens[],
    readonly indent: number,
    readonly run: RunCodeLens,
  ) {
    super();
  }

  eq(other: CodeLensWidget) {
    return (
      other.indent === this.indent &&
      other.run === this.run &&
      other.lenses.length === this.lenses.length &&
      other.lenses.every((lens, index) => {
        const mine = this.lenses[index];
        return lens.title === mine.title && lens.command === mine.command;
      })
    );
  }

  toDOM(view: EditorView) {
    const row = document.createElement("div");
    row.className = "cm-athas-code-lens";
    row.style.paddingLeft = `${this.indent}ch`;
    this.lenses.forEach((lens, index) => {
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "cm-athas-code-lens-separator";
        separator.textContent = "|";
        separator.setAttribute("aria-hidden", "true");
        row.append(separator);
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cm-athas-code-lens-item";
      item.textContent = lens.title;
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", (event) => {
        event.preventDefault();
        this.run(lens, view);
      });
      row.append(item);
    });
    return row;
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * Block widgets above each line that has code lenses, one row per line holding every lens for it.
 * Lenses without a command only label something, which Monaco skipped, so they are skipped too.
 */
export function codeLensDecorations(
  doc: Text,
  lenses: readonly LspCodeLens[],
  tabSize: number,
  run: RunCodeLens,
): DecorationSet {
  const byLine = new Map<number, LspCodeLens[]>();
  for (const lens of lenses) {
    if (!lens.command || lens.line < 0 || lens.line >= doc.lines) continue;
    const group = byLine.get(lens.line) ?? [];
    group.push(lens);
    byLine.set(lens.line, group);
  }
  const ranges: Range<Decoration>[] = [];
  for (const [lineIndex, group] of byLine) {
    const line = doc.line(lineIndex + 1);
    const indentText = /^\s*/.exec(line.text)?.[0] ?? "";
    const indent = countColumn(indentText, tabSize);
    ranges.push(
      Decoration.widget({
        widget: new CodeLensWidget(group, indent, run),
        block: true,
        side: -1,
      }).range(line.from),
    );
  }
  return Decoration.set(ranges, true);
}

export const setCodeLenses = StateEffect.define<DecorationSet>();

export const codeLensField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lenses, tr) {
    for (const effect of tr.effects) if (effect.is(setCodeLenses)) return effect.value;
    return lenses.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const SHOW_REFERENCES_COMMAND = "editor.action.showReferences";

interface LspPosition {
  line: number;
  character: number;
}

export interface LspLocation {
  uri: string;
  range: { start: LspPosition; end: LspPosition };
}

function isLspPosition(value: unknown): value is LspPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<LspPosition>;
  return typeof position.line === "number" && typeof position.character === "number";
}

function isLspLocation(value: unknown): value is LspLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<LspLocation>;
  return (
    typeof location.uri === "string" &&
    !!location.range &&
    isLspPosition(location.range.start) &&
    isLspPosition(location.range.end)
  );
}

/**
 * The `[uri, position, locations]` arguments of the `editor.action.showReferences` lens command
 * that servers such as typescript-language-server send, or null when they are malformed.
 */
export function parseShowReferencesArguments(
  argumentsValue: unknown[] | undefined,
): { uri: string; position: LspPosition; locations: LspLocation[] } | null {
  const [uri, position, locations] = argumentsValue ?? [];
  if (
    typeof uri !== "string" ||
    !isLspPosition(position) ||
    !Array.isArray(locations) ||
    !locations.every(isLspLocation)
  ) {
    return null;
  }
  return { uri, position, locations };
}
