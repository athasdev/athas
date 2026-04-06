import {
  Blocks,
  Box,
  Braces,
  Code2,
  Hash,
  Layers,
  LetterText,
  Puzzle,
  Variable,
} from "lucide-react";
import type { ReactNode } from "react";
import { CommandItem } from "@/ui/command";
import type { SymbolItem } from "../hooks/use-symbol-search";

const SYMBOL_ICONS: Record<string, ReactNode> = {
  function: <Code2 size={14} className="text-purple-400" />,
  method: <Code2 size={14} className="text-purple-400" />,
  constructor: <Code2 size={14} className="text-purple-400" />,
  class: <Blocks size={14} className="text-yellow-400" />,
  interface: <Puzzle size={14} className="text-cyan-400" />,
  struct: <Box size={14} className="text-yellow-400" />,
  enum: <Layers size={14} className="text-orange-400" />,
  "enum-member": <Hash size={14} className="text-orange-400" />,
  variable: <Variable size={14} className="text-blue-400" />,
  constant: <Variable size={14} className="text-blue-400" />,
  property: <Braces size={14} className="text-green-400" />,
  field: <Braces size={14} className="text-green-400" />,
  "type-parameter": <LetterText size={14} className="text-teal-400" />,
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
        <div className="truncate text-xs">
          <span className="text-text">{symbol.name}</span>
          {symbol.containerName && (
            <span className="ml-1.5 text-[10px] text-text-lighter opacity-60">
              {symbol.containerName}
            </span>
          )}
        </div>
      </div>
      <span className="rounded px-1 py-0.5 font-medium text-[10px] text-text-lighter">
        {symbol.kind}
      </span>
      <span className="tabular-nums text-[10px] text-text-lighter opacity-50">
        :{symbol.line + 1}
      </span>
    </CommandItem>
  );
};
