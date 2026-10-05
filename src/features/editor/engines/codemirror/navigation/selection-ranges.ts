import type { Text } from "@codemirror/state";
import type { SelectionRange as LspSelectionRange } from "vscode-languageserver-protocol";
import { fromLspPosition } from "./lsp-document";

export interface OffsetRange {
  from: number;
  to: number;
}

/** An LSP selection range chain as document ranges, innermost first, without repeats. */
export function flattenSelectionRanges(
  doc: Text,
  range: LspSelectionRange | undefined,
): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  for (let current = range; current; current = current.parent) {
    const from = fromLspPosition(doc, current.range.start);
    const to = fromLspPosition(doc, current.range.end);
    const next = { from: Math.min(from, to), to: Math.max(from, to) };
    const last = ranges[ranges.length - 1];
    if (!last || last.from !== next.from || last.to !== next.to) ranges.push(next);
  }
  return ranges;
}

/** The smallest range that strictly contains the selection, the next step of Expand Selection. */
export function expandSelectionTarget(
  ranges: readonly OffsetRange[],
  selection: OffsetRange,
): OffsetRange | null {
  return (
    ranges.find(
      (range) =>
        range.from <= selection.from &&
        range.to >= selection.to &&
        (range.from < selection.from || range.to > selection.to),
    ) ?? null
  );
}
