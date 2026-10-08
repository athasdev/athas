import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { type EditorView, type Panel, runScopeHandlers, type ViewUpdate } from "@codemirror/view";
import type React from "react";
import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { isComposingKeyboardEvent } from "@/features/keymaps/utils/is-composing-keyboard-event";
import {
  SEARCH_TOGGLE_ICONS,
  SearchPopover,
  SearchReplaceRow,
  SearchReplaceToggle,
} from "@/ui/search";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";
import {
  collectSearchMatches,
  formatSearchMatchLabel,
  isSearchReplaceOpen,
  mapSearchMatches,
  type SearchMatchList,
  type SearchMatchSummary,
  searchReplaceOpenField,
  setSearchReplaceOpen,
  summarizeMatchList,
} from "../search";
import "./codemirror-search.css";

const searchExtension = [
  searchReplaceOpenField,
  search({ createPanel: (view) => new AthasSearchPanel(view) }),
];

/** CodeMirror's search, shown as the Athas find widget. */
export function CodeMirrorSearch({ host }: { host: CodeMirrorHost }) {
  useCodeMirrorExtension(host.view, searchExtension);
  return null;
}

interface SearchPanelState {
  query: SearchQuery;
  matches: SearchMatchSummary;
  replaceOpen: boolean;
  readOnly: boolean;
}

/** How long the document must stay still before matches are counted again. */
export const SEARCH_RECOUNT_DELAY_MS = 150;

function sameSummary(left: SearchMatchSummary, right: SearchMatchSummary): boolean {
  return (
    left.current === right.current && left.total === right.total && left.capped === right.capped
  );
}

class AthasSearchPanel implements Panel {
  readonly dom = document.createElement("div");
  readonly top = true;
  private readonly root: Root;
  private state: SearchPanelState;
  private matchList: SearchMatchList;
  private recountTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly view: EditorView) {
    this.dom.className = "cm-search cm-athas-search";
    this.root = createRoot(this.dom);
    const query = getSearchQuery(view.state);
    this.matchList = collectSearchMatches(view.state, query);
    this.state = {
      query,
      matches: summarizeMatchList(this.matchList, view.state.selection.main),
      replaceOpen: isSearchReplaceOpen(view.state),
      readOnly: view.state.readOnly,
    };
    flushSync(() => this.render());
  }

  mount() {
    const field = this.dom.querySelector<HTMLInputElement>("[main-field]");
    field?.focus();
    field?.select();
  }

  update(update: ViewUpdate) {
    const queryChanged = update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(setSearchQuery)),
    );
    const replaceOpen = isSearchReplaceOpen(update.state);
    const replaceToggled = replaceOpen !== this.state.replaceOpen;
    if (
      !queryChanged &&
      !replaceToggled &&
      !update.docChanged &&
      !update.selectionSet &&
      update.startState.readOnly === update.state.readOnly
    ) {
      return;
    }

    const query = getSearchQuery(update.state);
    // Replacing from the panel should show the new count at once; typing in the text can wait.
    const replaced = update.transactions.some((transaction) =>
      transaction.isUserEvent("input.replace"),
    );
    if (queryChanged || query !== this.state.query || replaced) {
      this.recount();
    } else if (update.docChanged) {
      this.matchList = mapSearchMatches(this.matchList, update.changes);
      this.scheduleRecount();
    }

    this.setState(
      {
        query,
        matches: summarizeMatchList(this.matchList, update.state.selection.main),
        replaceOpen,
        readOnly: update.state.readOnly,
      },
      replaceToggled,
    );
  }

  destroy() {
    this.cancelRecount();
    const { root } = this;
    queueMicrotask(() => root.unmount());
  }

  private recount() {
    this.cancelRecount();
    this.matchList = collectSearchMatches(this.view.state, getSearchQuery(this.view.state));
  }

  private scheduleRecount() {
    this.cancelRecount();
    this.recountTimer = setTimeout(() => {
      this.recountTimer = null;
      this.recount();
      this.setState({
        ...this.state,
        matches: summarizeMatchList(this.matchList, this.view.state.selection.main),
      });
    }, SEARCH_RECOUNT_DELAY_MS);
  }

  private cancelRecount() {
    if (this.recountTimer === null) return;
    clearTimeout(this.recountTimer);
    this.recountTimer = null;
  }

  private setState(next: SearchPanelState, sync = false) {
    const current = this.state;
    if (
      next.query === current.query &&
      next.replaceOpen === current.replaceOpen &&
      next.readOnly === current.readOnly &&
      sameSummary(next.matches, current.matches)
    ) {
      return;
    }
    this.state = next;
    // The replace field must exist as soon as the row opens, for whoever focuses it next.
    if (sync) flushSync(() => this.render());
    else this.render();
  }

  private render() {
    this.root.render(<SearchPanelView view={this.view} {...this.state} />);
  }
}

function SearchPanelView({
  view,
  query,
  matches,
  replaceOpen,
  readOnly,
}: SearchPanelState & { view: EditorView }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const showReplace = replaceOpen && !readOnly;

  useLayoutEffect(() => {
    searchRef.current?.setAttribute("name", "search");
    searchRef.current?.setAttribute("main-field", "true");
    searchRef.current?.setAttribute("aria-label", "Find");
  }, []);

  useLayoutEffect(() => {
    replaceRef.current?.setAttribute("name", "replace");
    replaceRef.current?.setAttribute("aria-label", "Replace");
  }, [showReplace]);

  const updateQuery = (changes: Partial<ConstructorParameters<typeof SearchQuery>[0]>) => {
    const next = new SearchQuery({
      search: query.search,
      literal: query.literal,
      caseSensitive: query.caseSensitive,
      regexp: query.regexp,
      wholeWord: query.wholeWord,
      replace: query.replace,
      ...changes,
    });
    if (!next.eq(query)) view.dispatch({ effects: setSearchQuery.of(next) });
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    field: "find" | "replace",
  ) => {
    const nativeEvent = event.nativeEvent;
    if (event.defaultPrevented || isComposingKeyboardEvent(nativeEvent)) return;
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (event.key === "Escape") {
      consume();
      closeSearchPanel(view);
      view.focus();
      return;
    }
    if (event.key === "Enter") {
      consume();
      if (field === "find") (event.shiftKey ? findPrevious : findNext)(view);
      else if (event.metaKey || event.ctrlKey) replaceAll(view);
      else replaceNext(view);
      return;
    }
    if (runScopeHandlers(view, nativeEvent, "search-panel")) consume();
  };

  const setReplaceOpen = (open: boolean) => {
    view.dispatch({ effects: setSearchReplaceOpen.of(open) });
    if (open) replaceRef.current?.focus();
    else searchRef.current?.focus();
  };

  const hasMatches = matches.total > 0;
  const matchLabel = !query.search
    ? null
    : query.valid
      ? formatSearchMatchLabel(matches)
      : "Invalid pattern";

  return (
    <SearchPopover
      value={query.search}
      onChange={(search) => updateQuery({ search })}
      onKeyDown={(event) => handleKeyDown(event, "find")}
      onClose={() => {
        closeSearchPanel(view);
        view.focus();
      }}
      placeholder="Find"
      inputRef={searchRef}
      matchLabel={matchLabel}
      matchTone={query.search && !hasMatches ? "warning" : "default"}
      onNext={() => findNext(view)}
      onPrevious={() => findPrevious(view)}
      canNavigate={hasMatches}
      leadingControl={
        readOnly ? undefined : (
          <SearchReplaceToggle
            isExpanded={showReplace}
            onToggle={() => setReplaceOpen(!showReplace)}
          />
        )
      }
      options={[
        {
          id: "case-sensitive",
          label: "Match case",
          icon: SEARCH_TOGGLE_ICONS.caseSensitive,
          active: query.caseSensitive,
          onToggle: () => updateQuery({ caseSensitive: !query.caseSensitive }),
        },
        {
          id: "whole-word",
          label: "Match whole word",
          icon: SEARCH_TOGGLE_ICONS.wholeWord,
          active: query.wholeWord,
          onToggle: () => updateQuery({ wholeWord: !query.wholeWord }),
        },
        {
          id: "regex",
          label: "Use regular expression",
          icon: SEARCH_TOGGLE_ICONS.regex,
          active: query.regexp,
          onToggle: () => updateQuery({ regexp: !query.regexp }),
        },
      ]}
      secondaryRow={
        showReplace ? (
          <SearchReplaceRow
            value={query.replace}
            onChange={(replace) => updateQuery({ replace })}
            onKeyDown={(event) => handleKeyDown(event, "replace")}
            inputRef={replaceRef}
            onReplace={() => replaceNext(view)}
            onReplaceAll={() => replaceAll(view)}
            canReplace={hasMatches}
          />
        ) : undefined
      }
    />
  );
}
