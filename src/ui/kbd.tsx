import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-hover px-1 font-sans ui-text-sm font-medium text-text-lighter select-none [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
