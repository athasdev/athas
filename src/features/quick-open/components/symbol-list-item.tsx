import {
  SquaresFourIcon as Blocks,
  CubeIcon as Box,
  BracketsCurlyIcon as Braces,
  CodeIcon as Code2,
  HashIcon as Hash,
  StackIcon as Layers,
  TextTIcon as LetterText,
  PuzzlePieceIcon as Puzzle,
  FunctionIcon as Variable,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { CommandItemBadge, CommandItemRow } from "@/ui/command";
import type { SymbolItem } from "../hooks/use-symbol-search";
import { SearchMatchHighlight } from "./search-match-highlight";

const SYMBOL_ICONS: Record<string, ReactNode> = {
  function: <Code2 size={14} className="text-symbol-function" />,
  method: <Code2 size={14} className="text-symbol-function" />,
  constructor: <Code2 size={14} className="text-symbol-function" />,
  class: <Blocks size={14} className="text-symbol-type" />,
  interface: <Puzzle size={14} className="text-symbol-interface" />,
  struct: <Box size={14} className="text-symbol-type" />,
  enum: <Layers size={14} className="text-symbol-enum" />,
  "enum-member": <Hash size={14} className="text-symbol-enum" />,
  variable: <Variable size={14} className="text-symbol-variable" />,
  constant: <Variable size={14} className="text-symbol-variable" />,
  property: <Braces size={14} className="text-symbol-property" />,
  field: <Braces size={14} className="text-symbol-property" />,
  "type-parameter": <LetterText size={14} className="text-symbol-type-parameter" />,
};

interface SymbolListItemProps {
  symbol: SymbolItem;
  index: number;
  isSelected: boolean;
  onClick: (symbol: SymbolItem) => void;
  onMouseEnter?: (index: number) => void;
  searchQuery: string;
}

export const SymbolListItem = ({
  symbol,
  index,
  isSelected,
  onClick,
  onMouseEnter,
  searchQuery,
}: SymbolListItemProps) => {
  const icon = SYMBOL_ICONS[symbol.kind] || <Code2 size={14} className="text-text-lighter" />;

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
          <CommandItemBadge>{symbol.kind}</CommandItemBadge>
          <CommandItemBadge>:{symbol.line + 1}</CommandItemBadge>
        </>
      }
    />
  );
};
