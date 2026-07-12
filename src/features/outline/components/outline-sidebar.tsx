import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BracketsCurlyIcon as Braces,
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  CheckIcon as Check,
  CodeIcon as Code,
  CopyIcon as Copy,
  FunnelIcon as Funnel,
  FunctionIcon,
  MagnifyingGlassIcon as Search,
  SquaresFourIcon as SquaresFour,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import type { MenuItem } from "@/ui/dropdown";
import { writeClipboardText } from "@/utils/clipboard";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { openFile } from "@/features/file-system/controllers/platform";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { SidebarEmptyActionState, SidebarEmptyState, SidebarSearchFilterRow } from "@/ui/sidebar";
import { useDocumentOutline } from "../hooks/use-document-outline";
import type { OutlineSymbol } from "../types/outline-symbol.types";
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const symbolContextMenu = useContextMenu<OutlineSymbol>();
  const [focusedSymbolId, setFocusedSymbolId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const { activeBuffer, symbols, isLoading, isSupported } = useDocumentOutline(true);
  const openBuffer = useBufferStore.use.actions().openBuffer;
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
  const symbolsWithChildren = useMemo(
    () => symbols.filter((symbol) => symbol.childCount > 0),
    [symbols],
  );
  const handleOpenFile = useCallback(async () => {
    const selected = await openFile();
    if (!selected) return;

    const content = await readFileContent(selected);
    openBuffer(selected, selected.split(/[\\/]/).pop() || selected, content);
  }, [openBuffer]);

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

  const collapseAllSymbols = () => {
    setCollapsedIds(new Set(symbolsWithChildren.map((symbol) => symbol.id)));
  };

  const expandAllSymbols = () => {
    setCollapsedIds(new Set());
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
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      symbolContextMenu.openAt({ x: rect.left + 16, y: rect.bottom }, symbol);
      return;
    }

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

  const copyText = (text: string) => {
    void writeClipboardText(text);
  };

  const symbolContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const symbol = symbolContextMenu.data;
    if (!symbol) return [];

    const location = `${symbol.filePath}:${symbol.line + 1}:${symbol.character + 1}`;
    const isCollapsed = collapsedIds.has(symbol.id);

    return [
      {
        id: "go-to-symbol",
        label: "Go to Symbol",
        icon: <ArrowSquareOut />,
        onClick: () => {
          setFocusedSymbolId(symbol.id);
          openOutlineSymbol(symbol);
        },
      },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <Copy />,
        onClick: () => copyText(symbol.name),
      },
      {
        id: "copy-location",
        label: "Copy Location",
        icon: <Copy />,
        onClick: () => copyText(location),
      },
      { id: "sep-outline-actions", label: "", separator: true, onClick: () => {} },
      {
        id: "toggle-collapse",
        label: isCollapsed ? "Expand" : "Collapse",
        icon: isCollapsed ? <CaretDown /> : <CaretRight />,
        disabled: symbol.childCount === 0,
        onClick: () => toggleSymbol(symbol),
      },
      {
        id: "collapse-all",
        label: "Collapse All",
        icon: <CaretRight />,
        disabled: symbolsWithChildren.length === 0,
        onClick: collapseAllSymbols,
      },
      {
        id: "expand-all",
        label: "Expand All",
        icon: <CaretDown />,
        disabled: collapsedIds.size === 0,
        onClick: expandAllSymbols,
      },
    ];
  }, [collapsedIds, symbolContextMenu.data, symbolsWithChildren]);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-primary-bg"
      onKeyDownCapture={handleSidebarKeyDown}
    >
      <SidebarSearchFilterRow
        value={query}
        onChange={setQuery}
        searchIcon={Search}
        placeholder="Search"
        searchAriaLabel="Search outline"
        searchInputRef={searchInputRef}
        searchInputProps={{
          onKeyDown: (event) => {
            if (event.key === "ArrowDown" && visibleSymbols.length > 0) {
              event.preventDefault();
              focusSymbolAtIndex(0);
            }
          },
        }}
        filterOpen={isFilterMenuOpen}
        onFilterOpenChange={setIsFilterMenuOpen}
        filterItems={outlineFilterMenuItems}
        filterActive={!areAllFiltersSelected}
        filterTooltip="Filter Outline"
        filterAriaLabel="Filter outline"
        filterCloseOnSelect={false}
        filterMenuClassName="w-fit min-w-fit"
      />

      <div className="custom-scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1">
        {!isSupported ? (
          <SidebarEmptyActionState
            message={activeBuffer ? "No outline for the active file." : "No active file."}
            actionLabel="Open a File"
            onAction={() => void handleOpenFile()}
          />
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
              onContextMenu={(event) => {
                setFocusedSymbolId(symbol.id);
                symbolContextMenu.open(event, symbol);
              }}
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
      <ContextMenu
        isOpen={symbolContextMenu.isOpen}
        position={symbolContextMenu.position}
        items={symbolContextMenuItems}
        onClose={symbolContextMenu.close}
      />
    </div>
  );
}
