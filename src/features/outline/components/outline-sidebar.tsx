import {
  BracketsCurly as Braces,
  Check,
  Code,
  Funnel,
  Function as FunctionIcon,
  MagnifyingGlass as Search,
  SquaresFour,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import {
  SidebarEmptyState,
  SidebarHeader,
  SidebarHeaderIconButton,
  SidebarHeaderSearch,
} from "@/ui/sidebar";
import { useDocumentOutline } from "../hooks/use-document-outline";
import { getVisibleOutlineSymbols, openOutlineSymbol } from "../utils/outline-symbols";
import { OutlineSymbolRow } from "./outline-symbol-row";

type OutlineFilter = "types" | "functions" | "properties" | "variables" | "other";

const OUTLINE_FILTER_KINDS: Record<Exclude<OutlineFilter, "other">, Set<string>> = {
  types: new Set(["class", "interface", "struct", "enum", "type-parameter"]),
  functions: new Set(["function", "method", "constructor"]),
  properties: new Set(["property", "field", "enum-member"]),
  variables: new Set(["variable", "constant"]),
};

const OUTLINE_FILTER_OPTIONS: Array<{
  id: OutlineFilter;
  label: string;
  icon: ReactNode;
}> = [
  { id: "types", label: "Types", icon: <SquaresFour /> },
  { id: "functions", label: "Functions", icon: <FunctionIcon /> },
  { id: "properties", label: "Properties", icon: <Braces /> },
  { id: "variables", label: "Variables", icon: <Code /> },
  { id: "other", label: "Other", icon: <Code /> },
];

function matchesOutlineFilter(kind: string, selectedFilters: Set<OutlineFilter>) {
  if (selectedFilters.size === OUTLINE_FILTER_OPTIONS.length) return true;

  return OUTLINE_FILTER_OPTIONS.some((option) => {
    if (!selectedFilters.has(option.id)) return false;
    if (option.id === "other") {
      return !Object.values(OUTLINE_FILTER_KINDS).some((kinds) => kinds.has(kind));
    }
    return OUTLINE_FILTER_KINDS[option.id].has(kind);
  });
}

export function OutlineSidebar() {
  const [query, setQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState<Set<OutlineFilter>>(
    () => new Set(OUTLINE_FILTER_OPTIONS.map((option) => option.id)),
  );
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [focusedSymbolId, setFocusedSymbolId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const { symbols, isLoading, isSupported } = useDocumentOutline(true);
  const shouldShowHeader = isSupported && symbols.length > 0;
  const filteredSymbols = useMemo(
    () => symbols.filter((symbol) => matchesOutlineFilter(symbol.kind, selectedFilters)),
    [selectedFilters, symbols],
  );
  const visibleSymbols = useMemo(
    () => getVisibleOutlineSymbols(filteredSymbols, collapsedIds, query),
    [collapsedIds, filteredSymbols, query],
  );
  const areAllFiltersSelected = selectedFilters.size === OUTLINE_FILTER_OPTIONS.length;
  const setAllFilters = useCallback(() => {
    setSelectedFilters(new Set(OUTLINE_FILTER_OPTIONS.map((option) => option.id)));
  }, []);
  const toggleFilter = useCallback((filter: OutlineFilter) => {
    setSelectedFilters((currentFilters) => {
      const nextFilters = new Set(currentFilters);
      if (nextFilters.has(filter)) {
        nextFilters.delete(filter);
      } else {
        nextFilters.add(filter);
      }
      return nextFilters;
    });
  }, []);
  const outlineFilterMenuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: "all",
        label: "All",
        icon: <Funnel />,
        keybinding: areAllFiltersSelected ? <Check className="size-3.5 text-accent" /> : null,
        onClick: setAllFilters,
      },
      { id: "sep-filters", label: "", separator: true, onClick: () => {} },
      ...OUTLINE_FILTER_OPTIONS.map((option) => ({
        id: option.id,
        label: option.label,
        icon: option.icon,
        keybinding: selectedFilters.has(option.id) ? (
          <Check className="size-3.5 text-accent" />
        ) : null,
        onClick: () => toggleFilter(option.id),
      })),
    ],
    [areAllFiltersSelected, selectedFilters, setAllFilters, toggleFilter],
  );
  const focusedSymbolIndex = focusedSymbolId
    ? visibleSymbols.findIndex((symbol) => symbol.id === focusedSymbolId)
    : -1;

  useEffect(() => {
    if (visibleSymbols.length === 0) {
      setFocusedSymbolId(null);
      return;
    }

    if (!focusedSymbolId || !visibleSymbols.some((symbol) => symbol.id === focusedSymbolId)) {
      setFocusedSymbolId(visibleSymbols[0]?.id ?? null);
    }
  }, [focusedSymbolId, visibleSymbols]);

  const handleSymbolClick = (symbol: (typeof visibleSymbols)[number]) => {
    setFocusedSymbolId(symbol.id);
    openOutlineSymbol(symbol);
  };

  const toggleSymbol = (symbol: (typeof visibleSymbols)[number]) => {
    setCollapsedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(symbol.id)) {
        nextIds.delete(symbol.id);
      } else {
        nextIds.add(symbol.id);
      }
      return nextIds;
    });
  };

  const focusSymbolAtIndex = (index: number) => {
    const symbol = visibleSymbols[index];
    if (!symbol) return;

    setFocusedSymbolId(symbol.id);
    requestAnimationFrame(() => rowRefs.current.get(symbol.id)?.focus());
  };

  const focusSearch = () => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  };

  const handleSidebarKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target;
    const isTypingTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      focusSearch();
      return;
    }

    if (!isTypingTarget && event.key === "/") {
      event.preventDefault();
      focusSearch();
    }
  };

  const handleSymbolKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    symbol: (typeof visibleSymbols)[number],
  ) => {
    const currentIndex = visibleSymbols.findIndex(
      (visibleSymbol) => visibleSymbol.id === symbol.id,
    );
    if (currentIndex === -1) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusSymbolAtIndex(Math.min(currentIndex + 1, visibleSymbols.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusSymbolAtIndex(Math.max(currentIndex - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        focusSymbolAtIndex(0);
        break;
      case "End":
        event.preventDefault();
        focusSymbolAtIndex(visibleSymbols.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        handleSymbolClick(symbol);
        break;
      case "ArrowRight":
        if (symbol.childCount > 0 && collapsedIds.has(symbol.id)) {
          event.preventDefault();
          toggleSymbol(symbol);
        }
        break;
      case "ArrowLeft":
        if (symbol.childCount > 0 && !collapsedIds.has(symbol.id)) {
          event.preventDefault();
          toggleSymbol(symbol);
          break;
        }
        if (symbol.parentId) {
          const parentIndex = visibleSymbols.findIndex(
            (visibleSymbol) => visibleSymbol.id === symbol.parentId,
          );
          if (parentIndex >= 0) {
            event.preventDefault();
            focusSymbolAtIndex(parentIndex);
          }
        }
        break;
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-primary-bg"
      onKeyDownCapture={handleSidebarKeyDown}
    >
      {shouldShowHeader ? (
        <SidebarHeader>
          <SidebarHeaderSearch
            ref={searchInputRef}
            value={query}
            onChange={setQuery}
            leftIcon={Search}
            placeholder="Search"
            aria-label="Search outline"
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && visibleSymbols.length > 0) {
                event.preventDefault();
                focusSymbolAtIndex(0);
              }
            }}
          />
          <SidebarHeaderIconButton
            ref={filterButtonRef}
            active={!areAllFiltersSelected}
            className="shrink-0"
            tooltip="Filter Outline"
            tooltipSide="bottom"
            onClick={() => setIsFilterMenuOpen(true)}
          >
            <Funnel />
          </SidebarHeaderIconButton>
        </SidebarHeader>
      ) : null}

      <div className="custom-scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1">
        {!isSupported ? (
          <SidebarEmptyState>No outline for the active file.</SidebarEmptyState>
        ) : isLoading ? (
          <SidebarEmptyState>Loading outline...</SidebarEmptyState>
        ) : visibleSymbols.length === 0 ? (
          <SidebarEmptyState>No symbols found.</SidebarEmptyState>
        ) : (
          visibleSymbols.map((symbol) => (
            <OutlineSymbolRow
              key={symbol.id}
              ref={(node) => {
                if (node) {
                  rowRefs.current.set(symbol.id, node);
                } else {
                  rowRefs.current.delete(symbol.id);
                }
              }}
              symbol={symbol}
              compact
              selected={symbol.id === focusedSymbolId}
              collapsed={collapsedIds.has(symbol.id)}
              onClick={handleSymbolClick}
              onToggle={toggleSymbol}
              onMouseEnter={() => setFocusedSymbolId(symbol.id)}
              onKeyDown={(event) => handleSymbolKeyDown(event, symbol)}
              tabIndex={
                symbol.id === focusedSymbolId ||
                (focusedSymbolIndex === -1 && symbol === visibleSymbols[0])
                  ? 0
                  : -1
              }
            />
          ))
        )}
      </div>
      <Dropdown
        isOpen={isFilterMenuOpen}
        anchorRef={filterButtonRef}
        anchorSide="bottom"
        anchorAlign="end"
        items={outlineFilterMenuItems}
        onClose={() => setIsFilterMenuOpen(false)}
        closeOnSelect={false}
        className="w-fit min-w-fit"
      />
    </div>
  );
}
