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

const FALLBACK_ICON = <CodeIcon size={14} className="text-subtle-foreground" />;

export function getSymbolIcon(kind: string): ReactNode {
  return SYMBOL_ICONS[kind] ?? FALLBACK_ICON;
}
