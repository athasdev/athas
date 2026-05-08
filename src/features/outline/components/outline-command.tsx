import { ArrowLeft } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CommandEmpty, CommandHeader, CommandInput, CommandList } from "@/ui/command";
import { Button } from "@/ui/button";
import { getBaseName } from "@/utils/path-helpers";
import { useDocumentOutline } from "../hooks/use-document-outline";
import { getVisibleOutlineSymbols, openOutlineSymbol } from "../utils/outline-symbols";
import { OutlineSymbolRow } from "./outline-symbol-row";

interface OutlineCommandContentProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
}

export function OutlineCommandContent({ isActive, onBack, onClose }: OutlineCommandContentProps) {
  const [query, setQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { filePath, symbols, isLoading, isSupported } = useDocumentOutline(isActive);
  const visibleSymbols = useMemo(
    () => getVisibleOutlineSymbols(symbols, collapsedIds, query),
    [collapsedIds, query, symbols],
  );

  useEffect(() => {
    if (!isActive) return;
    setQuery("");
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isActive]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const selectedElement = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const selectSymbol = (index: number) => {
    const symbol = visibleSymbols[index];
    if (!symbol) return;
    openOutlineSymbol(symbol);
    onClose();
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(0, visibleSymbols.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectSymbol(selectedIndex);
    }
  };

  return (
    <>
      <CommandHeader onClose={onClose}>
        <Button variant="ghost" size="icon-xs" className="rounded" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          placeholder={filePath ? `Outline: ${getBaseName(filePath)}` : "Outline"}
        />
        <span className="ui-font ui-text-xs shrink-0 text-text-lighter">
          {isLoading ? "..." : `${visibleSymbols.length}`}
        </span>
      </CommandHeader>

      <CommandList ref={listRef}>
        {!isSupported ? (
          <CommandEmpty>No outline for the active file</CommandEmpty>
        ) : isLoading ? (
          <CommandEmpty>Loading outline...</CommandEmpty>
        ) : visibleSymbols.length === 0 ? (
          <CommandEmpty>No symbols found</CommandEmpty>
        ) : (
          visibleSymbols.map((symbol, index) => (
            <OutlineSymbolRow
              key={symbol.id}
              symbol={symbol}
              selected={index === selectedIndex}
              collapsed={collapsedIds.has(symbol.id)}
              onClick={() => selectSymbol(index)}
              onToggle={toggleSymbol}
              onMouseEnter={() => setSelectedIndex(index)}
            />
          ))
        )}
      </CommandList>
    </>
  );
}
