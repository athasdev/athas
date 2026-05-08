import type React from "react";
import { cn } from "@/utils/cn";

type TreeRowProps = React.ComponentProps<"button"> & {
  active?: boolean;
  depth?: number;
  indentSize?: number;
  baseIndent?: number;
};

export function TreeRow({
  active = false,
  depth = 0,
  indentSize = 14,
  baseIndent = 14,
  className,
  style,
  children,
  ...props
}: TreeRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "file-tree-row ui-font ui-text-xs flex w-full min-w-max cursor-pointer select-none items-center whitespace-nowrap rounded-md border-none bg-transparent text-left text-text outline-none transition-colors duration-150 hover:bg-hover focus:outline-none",
        active && "bg-selected",
        className,
      )}
      style={
        {
          paddingLeft: `${baseIndent + depth * indentSize}px`,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </button>
  );
}
