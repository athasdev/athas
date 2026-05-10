import {
  BracketsCurly as Braces,
  CaretDown,
  CaretRight,
  Code,
  Cube,
  Function as FunctionIcon,
  Hash,
  IconContext,
  Package,
  PuzzlePiece,
  SquaresFour,
  Stack,
  TextT,
} from "@phosphor-icons/react";
import { forwardRef } from "react";
import { TreeRow } from "@/ui/tree-row";
import type { OutlineSymbol } from "../types/outline-symbol";

function OutlineSymbolIcon({ kind, className = "size-3.5" }: { kind: string; className?: string }) {
  return (
    <IconContext.Provider value={{ weight: "regular" }}>
      {(() => {
        switch (kind) {
          case "class":
            return <SquaresFour className={`${className} text-amber-500`} />;
          case "interface":
            return <PuzzlePiece className={`${className} text-sky-500`} />;
          case "struct":
            return <Cube className={`${className} text-amber-500`} />;
          case "enum":
            return <Stack className={`${className} text-orange-500`} />;
          case "enum-member":
            return <Hash className={`${className} text-orange-500`} />;
          case "property":
          case "field":
            return <Braces className={`${className} text-emerald-500`} />;
          case "function":
          case "method":
          case "constructor":
            return <FunctionIcon className={`${className} text-violet-500`} />;
          case "variable":
          case "constant":
            return <Code className={`${className} text-blue-500`} />;
          case "module":
          case "namespace":
          case "package":
            return <Package className={`${className} text-text-lighter`} />;
          case "type-parameter":
            return <TextT className={`${className} text-teal-500`} />;
          default:
            return <Code className={`${className} text-text-lighter`} />;
        }
      })()}
    </IconContext.Provider>
  );
}

interface OutlineSymbolRowProps {
  symbol: OutlineSymbol;
  selected?: boolean;
  compact?: boolean;
  collapsed?: boolean;
  onClick: (symbol: OutlineSymbol) => void;
  onToggle?: (symbol: OutlineSymbol) => void;
  onMouseEnter?: () => void;
  tabIndex?: number;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const OutlineSymbolRow = forwardRef<HTMLButtonElement, OutlineSymbolRowProps>(
  function OutlineSymbolRow(
    {
      symbol,
      selected = false,
      compact = false,
      collapsed = false,
      onClick,
      onToggle,
      onMouseEnter,
      tabIndex,
      onKeyDown,
    },
    ref,
  ) {
    const hasChildren = symbol.childCount > 0;
    const rowHeightClassName = compact ? "h-6" : "h-7";

    return (
      <TreeRow
        ref={ref}
        active={selected}
        baseIndent={8}
        depth={symbol.depth}
        indentSize={14}
        onClick={() => onClick(symbol)}
        onMouseEnter={onMouseEnter}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
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
  },
);
