import {
  BracketsCurlyIcon,
  CodeIcon,
  CubeIcon,
  FunctionIcon,
  GridIcon,
  HashIcon,
  PuzzlePieceIcon,
  StackIcon,
  TextIcon,
} from "@/ui/icons";
import type { ReactNode } from "react";
import { CommandItemBadge, CommandItemRow } from "@/ui/command";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import type { SymbolItem } from "../hooks/use-symbol-search";

const SYMBOL_ICONS: Record<string, ReactNode> = {
  function: <CodeIcon size={14} className="text-symbol-function" />,
  method: <CodeIcon size={14} className="text-symbol-function" />,
  constructor: <CodeIcon size={14} className="text-symbol-function" />,
  class: <GridIcon size={14} className="text-symbol-type" />,
  interface: <PuzzlePieceIcon size={14} className="text-symbol-interface" />,
  struct: <CubeIcon size={14} className="text-symbol-type" />,
  enum: <StackIcon size={14} className="text-symbol-enum" />,
  "enum-member": <HashIcon size={14} className="text-symbol-enum" />,
  variable: <FunctionIcon size={14} className="text-symbol-variable" />,
  constant: <FunctionIcon size={14} className="text-symbol-variable" />,
  property: <BracketsCurlyIcon size={14} className="text-symbol-property" />,
  field: <BracketsCurlyIcon size={14} className="text-symbol-property" />,
  "type-parameter": <TextIcon size={14} className="text-symbol-type-parameter" />,
};

interface SymbolListItemProps {
  symbol: SymbolItem;
  index: number;
  isSelected: boolean;
  onClick: (symbol: SymbolItem) => void;
  onMouseEnter?: (index: number) => void;
  searchQuery: string;
  /** Render a file-path badge alongside the container name. Off by default so the
   * existing `@`-mode (file-scoped) call site renders identically to before. */
  showFilePath?: boolean;
}

export const SymbolListItem = ({
  symbol,
  index,
  isSelected,
  onClick,
  onMouseEnter,
  searchQuery,
  showFilePath = false,
}: SymbolListItemProps) => {
  const icon = SYMBOL_ICONS[symbol.kind] || (
    <CodeIcon size={14} className="text-subtle-foreground" />
  );
  const fileBaseName = showFilePath ? symbol.filePath.split(/[/\\]/).pop() : undefined;

  return (
    <CommandItemRow
      data-item-index={index}
      onClick={() => onClick(symbol)}
      onMouseEnter={() => onMouseEnter?.(index)}
      isSelected={isSelected}
      icon={icon}
      title={<SearchMatchHighlight text={symbol.name} query={searchQuery} />}
      description={
        symbol.containerName ? (
          <SearchMatchHighlight text={symbol.containerName} query={searchQuery} />
        ) : undefined
      }
      accessory={
        <>
          {fileBaseName && <CommandItemBadge>{fileBaseName}</CommandItemBadge>}
          <CommandItemBadge>{symbol.kind}</CommandItemBadge>
          <CommandItemBadge>:{symbol.line + 1}</CommandItemBadge>
        </>
      }
    />
  );
};
