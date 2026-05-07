import { useMemo, useState } from "react";
import Input from "@/ui/input";
import { useDocumentOutline } from "../hooks/use-document-outline";
import { getVisibleOutlineSymbols, openOutlineSymbol } from "../utils/outline-symbols";
import { OutlineSymbolRow } from "./outline-symbol-row";

export function OutlineSidebarView() {
  const [query, setQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const { symbols, isLoading, isSupported } = useDocumentOutline(true);
  const visibleSymbols = useMemo(
    () => getVisibleOutlineSymbols(symbols, collapsedIds, query),
    [collapsedIds, query, symbols],
  );

  const handleSymbolClick = (symbol: (typeof visibleSymbols)[number]) => {
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <div className="shrink-0 border-border border-b p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search outline"
          className="h-7 text-xs"
        />
      </div>

      <div className="custom-scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1">
        {!isSupported ? (
          <div className="p-3 text-text-lighter text-xs">No outline for the active file.</div>
        ) : isLoading ? (
          <div className="p-3 text-text-lighter text-xs">Loading outline...</div>
        ) : visibleSymbols.length === 0 ? (
          <div className="p-3 text-text-lighter text-xs">No symbols found.</div>
        ) : (
          visibleSymbols.map((symbol) => (
            <OutlineSymbolRow
              key={symbol.id}
              symbol={symbol}
              compact
              collapsed={collapsedIds.has(symbol.id)}
              onClick={handleSymbolClick}
              onToggle={toggleSymbol}
            />
          ))
        )}
      </div>
    </div>
  );
}
