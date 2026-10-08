import { openSearchPanel, type SearchQuery } from "@codemirror/search";
import { type ChangeDesc, type EditorState, StateEffect, StateField } from "@codemirror/state";
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

const SEARCH_REPLACE_FIELD_SELECTOR = ".cm-search input[name=replace]";

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

const SEARCH_MATCH_LIMIT = 9999;

/** Every match of a query, in document order, so the current one can be found without a rescan. */
export interface SearchMatchList {
  starts: number[];
  ends: number[];
  capped: boolean;
}

const NO_MATCHES: SearchMatchList = { starts: [], ends: [], capped: false };

export function collectSearchMatches(
  state: EditorState,
  query: SearchQuery,
  limit = SEARCH_MATCH_LIMIT,
): SearchMatchList {
  if (!query.search || !query.valid) return NO_MATCHES;

  const starts: number[] = [];
  const ends: number[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    starts.push(next.value.from);
    ends.push(next.value.to);
    if (starts.length >= limit) return { starts, ends, capped: !cursor.next().done };
  }
  return { starts, ends, capped: false };
}

/** Moves the matches through an edit, until they can be counted again. */
export function mapSearchMatches(matches: SearchMatchList, changes: ChangeDesc): SearchMatchList {
  if (matches.starts.length === 0) return matches;
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < matches.starts.length; index++) {
    const from = changes.mapPos(matches.starts[index], 1);
    const to = changes.mapPos(matches.ends[index], -1);
    if (to < from) continue;
    starts.push(from);
    ends.push(to);
  }
  return { starts, ends, capped: matches.capped };
}

export function summarizeMatchList(
  matches: SearchMatchList,
  selection: { from: number; to: number },
): SearchMatchSummary {
  const { starts, ends } = matches;
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] < selection.from) low = middle + 1;
    else high = middle;
  }
  let current = 0;
  for (let index = low; index < starts.length && starts[index] === selection.from; index++) {
    if (ends[index] === selection.to) {
      current = index + 1;
      break;
    }
  }
  return { current, total: starts.length, capped: matches.capped };
}

export function summarizeSearchMatches(
  state: EditorState,
  query: SearchQuery,
  limit = SEARCH_MATCH_LIMIT,
): SearchMatchSummary {
  return summarizeMatchList(collectSearchMatches(state, query, limit), state.selection.main);
}

export function formatSearchMatchLabel(summary: SearchMatchSummary): string {
  if (summary.total === 0) return "No results";
  const total = `${summary.total}${summary.capped ? "+" : ""}`;
  return `${summary.current > 0 ? summary.current : "?"} of ${total}`;
}
