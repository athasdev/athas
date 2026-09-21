import {
  BracketsCurlyIcon,
  CodeIcon,
  CubeIcon,
  FunctionIcon,
  GridIcon,
  HashIcon,
  PackageIcon,
  PuzzlePieceIcon,
  StackIcon,
  TextIcon,
} from "@/ui/icons";
import { forwardRef } from "react";
import { SidebarTreeRow } from "@/features/sidebar/components/sidebar-tree";
import type { OutlineSymbol } from "../types/outline-symbol.types";

function OutlineSymbolIcon({ kind, className = "size-3.5" }: { kind: string; className?: string }) {
  return (
    <>
      {(() => {
        switch (kind) {
          case "class":
            return <GridIcon className={`${className} text-symbol-type`} />;
          case "interface":
            return <PuzzlePieceIcon className={`${className} text-symbol-interface`} />;
          case "struct":
            return <CubeIcon className={`${className} text-symbol-type`} />;
          case "enum":
            return <StackIcon className={`${className} text-symbol-enum`} />;
          case "enum-member":
            return <HashIcon className={`${className} text-symbol-enum`} />;
          case "property":
          case "field":
            return <BracketsCurlyIcon className={`${className} text-symbol-property`} />;
          case "function":
          case "method":
          case "constructor":
            return <FunctionIcon className={`${className} text-symbol-function`} />;
          case "variable":
          case "constant":
            return <CodeIcon className={`${className} text-symbol-variable`} />;
          case "module":
          case "namespace":
          case "package":
            return <PackageIcon className={`${className} text-subtle-foreground`} />;
          case "type-parameter":
            return <TextIcon className={`${className} text-symbol-type-parameter`} />;
          default:
            return <CodeIcon className={`${className} text-subtle-foreground`} />;
        }
      })()}
    </>
  );
}

interface OutlineSymbolRowProps {
  symbol: OutlineSymbol;
  selected?: boolean;
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
        label={symbol.name}
        description={symbol.detail}
        leading={<OutlineSymbolIcon kind={symbol.kind} />}
        expanded={hasChildren ? !collapsed : undefined}
        reserveDisclosureSpace
        onToggle={() => onToggle?.(symbol)}
      />
    );
  },
);
