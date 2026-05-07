import {
  BracketsCurly as Braces,
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

interface OutlineSymbolIconProps {
  kind: string;
  className?: string;
}

export function OutlineSymbolIcon({ kind, className = "size-3.5" }: OutlineSymbolIconProps) {
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
