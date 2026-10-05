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
  formatSearchMatchLabel,
  isSearchReplaceOpen,
  type SearchMatchSummary,
  searchReplaceOpenField,
  setSearchReplaceOpen,
  summarizeSearchMatches,
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

function readPanelState(view: EditorView): SearchPanelState {
  const query = getSearchQuery(view.state);
  return {
    query,
    matches: summarizeSearchMatches(view.state, query),
    replaceOpen: isSearchReplaceOpen(view.state),
    readOnly: view.state.readOnly,
  };
}

class AthasSearchPanel implements Panel {
  readonly dom = document.createElement("div");
  readonly top = true;
  private readonly root: Root;
  private state: SearchPanelState;

  constructor(private readonly view: EditorView) {
    this.dom.className = "cm-search cm-athas-search";
    this.root = createRoot(this.dom);
    this.state = readPanelState(view);
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
    this.state = readPanelState(this.view);
    // The replace field must exist as soon as the row opens, for whoever focuses it next.
    if (replaceToggled) flushSync(() => this.render());
    else this.render();
  }

  destroy() {
    const { root } = this;
    queueMicrotask(() => root.unmount());
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
