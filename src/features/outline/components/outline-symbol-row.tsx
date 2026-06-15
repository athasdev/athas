import {
  BracketsCurlyIcon as Braces,
  CodeIcon as Code,
  CubeIcon as Cube,
  FunctionIcon,
  HashIcon as Hash,
  IconContext,
  PackageIcon as Package,
  PuzzlePieceIcon as PuzzlePiece,
  SquaresFourIcon as SquaresFour,
  StackIcon as Stack,
  TextTIcon as TextT,
} from "@phosphor-icons/react";
import { forwardRef } from "react";
import {
  SidebarTreeDisclosure,
  SidebarTreeIcon,
  SidebarTreeRow,
} from "@/features/sidebar-tree/components/sidebar-tree";
import type { OutlineSymbol } from "../types/outline-symbol.types";

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
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
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
      onContextMenu,
      tabIndex,
      onKeyDown,
    },
    ref,
  ) {
    const hasChildren = symbol.childCount > 0;
    const rowHeightClassName = compact ? "h-6" : "h-7";

    return (
      <SidebarTreeRow
        ref={ref}
        active={selected}
        depth={symbol.depth}
        onClick={() => onClick(symbol)}
        onMouseEnter={onMouseEnter}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
        className={rowHeightClassName}
      >
        <SidebarTreeDisclosure
          visible={hasChildren}
          expanded={!collapsed}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggle?.(symbol);
          }}
        />

        <SidebarTreeIcon icon={<OutlineSymbolIcon kind={symbol.kind} />} />
        <span className="ml-1.5 min-w-0 flex-1 truncate">
          <span className="ui-text-xs text-text">{symbol.name}</span>
          {symbol.detail ? (
            <span className="ml-1.5 ui-text-xs text-text-lighter opacity-70">{symbol.detail}</span>
          ) : null}
        </span>
      </SidebarTreeRow>
    );
  },
);
