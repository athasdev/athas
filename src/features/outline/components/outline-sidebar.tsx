import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BracketsCurlyIcon as Braces,
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  CodeIcon as Code,
  CopyIcon as Copy,
  FunnelIcon as Funnel,
  FunctionIcon,
  SquaresFourIcon as SquaresFour,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { writeClipboardText } from "@/utils/clipboard";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { openFile } from "@/features/file-system/controllers/platform";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { EmptyState } from "@/ui/empty";
import {
  SidebarHeader,
  SidebarHeaderIconButton,
  SidebarSearchPopover,
  SidebarPanel,
} from "@/ui/sidebar";
import { ScrollArea } from "@/ui/scroll-area";
import { Spinner } from "@/ui/spinner";
import { useDocumentOutline } from "../hooks/use-document-outline";
import { getOutlineRevealScrollTop } from "../utils/outline-scroll";
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<Set<OutlineFilter>>(
    () => new Set(OUTLINE_FILTER_OPTIONS.map((option) => option.id)),
  );
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [focusedSymbolId, setFocusedSymbolId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const { activeBuffer, symbols, isLoading, isSupported } = useDocumentOutline({ isActive: true });
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

  const revealSymbol = useCallback((symbolId: string) => {
    const viewport = scrollViewportRef.current;
    const row = rowRefs.current.get(symbolId);
    if (!viewport || !row) return;

    const viewportRect = viewport.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const nextScrollTop = getOutlineRevealScrollTop({
      scrollTop: viewport.scrollTop,
      viewportTop: viewportRect.top,
      viewportBottom: viewportRect.bottom,
      rowTop: rowRect.top,
      rowBottom: rowRect.bottom,
    });

    if (nextScrollTop !== null) {
      viewport.scrollTo({ top: nextScrollTop, behavior: "auto" });
    }
  }, []);

  const focusSymbolAtIndex = (index: number) => {
    const symbol = visibleSymbols[index];
    if (!symbol) return;

    setFocusedSymbolId(symbol.id);
    requestAnimationFrame(() => {
      rowRefs.current.get(symbol.id)?.focus({ preventScroll: true });
      revealSymbol(symbol.id);
    });
  };

  const focusSearch = () => {
    setIsSearchOpen(true);
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

  const copyText = (text: string) => {
    void writeClipboardText(text);
  };

  return (
    <SidebarPanel onKeyDownCapture={handleSidebarKeyDown}>
      <SidebarHeader className="px-3">
        <SidebarSearchPopover
          value={query}
          onChange={setQuery}
          open={isSearchOpen}
          onOpenChange={setIsSearchOpen}
          aria-label="Search outline"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && visibleSymbols.length > 0) {
              event.preventDefault();
              focusSymbolAtIndex(0);
            }
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarHeaderIconButton
                active={!areAllFiltersSelected}
                tooltip="Filter outline"
                tooltipSide="bottom"
                aria-label="Filter outline"
              />
            }
          >
            <Funnel />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              disabled={areAllFiltersSelected}
              closeOnClick={false}
              onClick={setAllFilters}
            >
              <Funnel />
              Show All
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {OUTLINE_FILTER_OPTIONS.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.id}
                checked={selectedFilters.has(option.id)}
                closeOnClick={false}
                onCheckedChange={() => toggleFilter(option.id)}
              >
                {option.icon}
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <ScrollArea
        className="min-h-0 min-w-0 flex-1"
        viewportClassName="overscroll-contain"
        viewportProps={{
          ref: scrollViewportRef,
          style: {
            overflowAnchor: "none",
            scrollBehavior: "auto",
            scrollPaddingBlock: "4px",
          },
        }}
        contentClassName="p-1"
      >
        {!isSupported ? (
          <EmptyState
            message={activeBuffer ? "No outline for the active file." : "No active file."}
            action={{ label: "Open a File", onClick: () => void handleOpenFile() }}
          />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner label="Loading outline" showLabel compact />
          </div>
        ) : visibleSymbols.length === 0 ? (
          <EmptyState message="No symbols found." />
        ) : (
          visibleSymbols.map((symbol) => (
            <ContextMenu key={symbol.id}>
              <ContextMenuTrigger onContextMenu={() => setFocusedSymbolId(symbol.id)}>
                <OutlineSymbolRow
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
                  onKeyDown={(event) => handleSymbolKeyDown(event, symbol)}
                  tabIndex={
                    symbol.id === focusedSymbolId ||
                    (focusedSymbolIndex === -1 && symbol === visibleSymbols[0])
                      ? 0
                      : -1
                  }
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onClick={() => {
                    setFocusedSymbolId(symbol.id);
                    openOutlineSymbol(symbol);
                  }}
                >
                  <ArrowSquareOut />
                  Go to Symbol
                </ContextMenuItem>
                <ContextMenuItem onClick={() => copyText(symbol.name)}>
                  <Copy />
                  Copy Name
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    copyText(`${symbol.filePath}:${symbol.line + 1}:${symbol.character + 1}`)
                  }
                >
                  <Copy />
                  Copy Location
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={symbol.childCount === 0}
                  onClick={() => toggleSymbol(symbol)}
                >
                  {collapsedIds.has(symbol.id) ? <CaretDown /> : <CaretRight />}
                  {collapsedIds.has(symbol.id) ? "Expand" : "Collapse"}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={symbolsWithChildren.length === 0}
                  onClick={collapseAllSymbols}
                >
                  <CaretRight />
                  Collapse All
                </ContextMenuItem>
                <ContextMenuItem disabled={collapsedIds.size === 0} onClick={expandAllSymbols}>
                  <CaretDown />
                  Expand All
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))
        )}
      </ScrollArea>
    </SidebarPanel>
  );
}
