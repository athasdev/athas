import { foldService } from "@codemirror/language";
import { StateEffect, StateField, type Text } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";

interface LspFoldingRange {
  startLine: number;
  endLine: number;
}

interface FoldRegion {
  from: number;
  to: number;
}

export const setLspFoldingRanges = StateEffect.define<FoldRegion[]>({
  map: (regions, mapping) =>
    regions.map((region) => ({ from: mapping.mapPos(region.from), to: mapping.mapPos(region.to) })),
});

/**
 * Fold regions for LSP folding ranges: from the end of the start line to the end of the end line,
 * the lines Monaco hid for the same range. Ranges that would fold nothing are dropped.
 */
export function lspFoldRegions(doc: Text, ranges: readonly LspFoldingRange[]): FoldRegion[] {
  const regions: FoldRegion[] = [];
  for (const range of ranges) {
    if (range.startLine < 0 || range.endLine <= range.startLine) continue;
    if (range.startLine + 1 > doc.lines) continue;
    const start = doc.line(range.startLine + 1);
    const end = doc.line(Math.min(doc.lines, range.endLine + 1));
    if (end.to > start.to) regions.push({ from: start.to, to: end.to });
  }
  return regions.sort((a, b) => a.from - b.from || b.to - a.to);
}

const lspFoldingField = StateField.define<FoldRegion[]>({
  create: () => [],
  update(regions, tr) {
    for (const effect of tr.effects) if (effect.is(setLspFoldingRanges)) return effect.value;
    if (!tr.docChanged || regions.length === 0) return regions;
    return regions
      .map((region) => ({ from: tr.changes.mapPos(region.from), to: tr.changes.mapPos(region.to) }))
      .filter((region) => region.to > region.from);
  },
});

/**
 * LSP folding ranges, asked before syntax folding: a line the server gives a range for folds the
 * way the server says, any other line falls back to the language's syntax tree.
 */
const lspFoldService = foldService.of((state, lineStart, lineEnd) => {
  const regions = state.field(lspFoldingField, false);
  if (!regions?.length) return null;
  let best: FoldRegion | null = null;
  for (const region of regions) {
    if (region.from < lineStart) continue;
    if (region.from > lineEnd) break;
    if (!best || region.to > best.to) best = region;
  }
  if (!best) return null;
  if (state.doc.lineAt(best.to).number <= state.doc.lineAt(best.from).number) return null;
  return best;
});

/**
 * For the editor's `foldGutter({ foldingChanged })`, so fold markers redraw as soon as new LSP
 * ranges arrive rather than on the next edit or scroll.
 */
export function lspFoldingChanged(update: ViewUpdate): boolean {
  return update.transactions.some((tr) =>
    tr.effects.some((effect) => effect.is(setLspFoldingRanges)),
  );
}

export const lspFolding = [lspFoldingField, lspFoldService];
