import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { TreeRow } from "@/ui/tree-row";
import { OutlineSymbolIcon } from "./outline-symbol-icon";
import type { OutlineSymbol } from "../types";

interface OutlineSymbolRowProps {
  symbol: OutlineSymbol;
  selected?: boolean;
  compact?: boolean;
  collapsed?: boolean;
  onClick: (symbol: OutlineSymbol) => void;
  onToggle?: (symbol: OutlineSymbol) => void;
  onMouseEnter?: () => void;
}

export function OutlineSymbolRow({
  symbol,
  selected = false,
  compact = false,
  collapsed = false,
  onClick,
  onToggle,
  onMouseEnter,
}: OutlineSymbolRowProps) {
  const hasChildren = symbol.childCount > 0;
  const rowHeightClassName = compact ? "h-6" : "h-7";

  return (
    <TreeRow
      active={selected}
      baseIndent={8}
      depth={symbol.depth}
      indentSize={14}
      onClick={() => onClick(symbol)}
      onMouseEnter={onMouseEnter}
      className={rowHeightClassName}
    >
      <span
        className={[
          "mr-0.5 flex size-4 shrink-0 items-center justify-center rounded text-text-lighter transition-colors",
          hasChildren ? "hover:text-text" : "pointer-events-none text-transparent",
        ].join(" ")}
        onClick={(event) => {
          event.stopPropagation();
          if (hasChildren) onToggle?.(symbol);
        }}
      >
        {hasChildren ? (
          collapsed ? (
            <CaretRight className="size-3" weight="bold" />
          ) : (
            <CaretDown className="size-3" weight="bold" />
          )
        ) : (
          <span className="size-3" />
        )}
      </span>

      <span className="shrink-0">
        <OutlineSymbolIcon kind={symbol.kind} />
      </span>
      <span className="ml-1.5 min-w-0 flex-1 truncate">
        <span className="text-xs text-text">{symbol.name}</span>
        {symbol.detail ? (
          <span className="ml-1.5 text-[10px] text-text-lighter opacity-70">{symbol.detail}</span>
        ) : null}
      </span>
    </TreeRow>
  );
}
