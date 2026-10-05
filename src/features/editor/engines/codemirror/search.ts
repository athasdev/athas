import { openSearchPanel, type SearchQuery } from "@codemirror/search";
import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export const setSearchReplaceOpen = StateEffect.define<boolean>();

/** Whether the search panel shows its replace row. */
export const searchReplaceOpenField = StateField.define<boolean>({
  create: () => false,
  update(open, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchReplaceOpen)) open = effect.value;
    }
    return open;
  },
});

export function isSearchReplaceOpen(state: EditorState): boolean {
  return !state.readOnly && (state.field(searchReplaceOpenField, false) ?? false);
}

export const SEARCH_REPLACE_FIELD_SELECTOR = ".cm-search input[name=replace]";

/**
 * Opens the search panel, with the replace row shown and focused when `replace` is set and the
 * editor is editable, and the find field focused otherwise.
 */
export function openCodeMirrorSearch(view: EditorView, { replace = false } = {}): void {
  if (replace && !view.state.readOnly) {
    view.dispatch({
      effects:
        view.state.field(searchReplaceOpenField, false) === undefined
          ? StateEffect.appendConfig.of(searchReplaceOpenField.init(() => true))
          : setSearchReplaceOpen.of(true),
    });
  }
  openSearchPanel(view);
  if (!replace) return;
  const field = view.dom.querySelector<HTMLInputElement>(SEARCH_REPLACE_FIELD_SELECTOR);
  field?.focus();
  field?.select();
}

export interface SearchMatchSummary {
  /** One-based index of the match the main selection covers, or 0 when it covers none. */
  current: number;
  total: number;
  /** The count stopped at the limit, so there are more matches than `total`. */
  capped: boolean;
}

export const SEARCH_MATCH_LIMIT = 9999;

export function summarizeSearchMatches(
  state: EditorState,
  query: SearchQuery,
  limit = SEARCH_MATCH_LIMIT,
): SearchMatchSummary {
  if (!query.search || !query.valid) return { current: 0, total: 0, capped: false };

  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++;
    if (next.value.from === from && next.value.to === to) current = total;
    if (total >= limit) return { current, total, capped: !cursor.next().done };
  }
  return { current, total, capped: false };
}

export function formatSearchMatchLabel(summary: SearchMatchSummary): string {
  if (summary.total === 0) return "No results";
  const total = `${summary.total}${summary.capped ? "+" : ""}`;
  return `${summary.current > 0 ? summary.current : "?"} of ${total}`;
}
