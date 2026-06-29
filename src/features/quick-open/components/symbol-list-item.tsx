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
import { CommandItem } from "@/ui/command";
import type { SymbolItem } from "../hooks/use-symbol-search";

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
}

export const SymbolListItem = ({
  symbol,
  index,
  isSelected,
  onClick,
  onMouseEnter,
}: SymbolListItemProps) => {
  const icon = SYMBOL_ICONS[symbol.kind] || <Code2 size={14} className="text-text-lighter" />;

  return (
    <CommandItem
      data-item-index={index}
      onClick={() => onClick(symbol)}
      onMouseEnter={() => onMouseEnter?.(index)}
      isSelected={isSelected}
      className="ui-font"
    >
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate ui-text-base">
          <span className="text-text">{symbol.name}</span>
          {symbol.containerName && (
            <span className="ml-1.5 ui-text-base text-text-lighter opacity-60">
              {symbol.containerName}
            </span>
          )}
        </div>
      </div>
      <span className="rounded px-1 py-0.5 font-medium ui-text-base text-text-lighter">
        {symbol.kind}
      </span>
      <span className="tabular-nums ui-text-base text-text-lighter opacity-50">
        :{symbol.line + 1}
      </span>
    </CommandItem>
  );
};
