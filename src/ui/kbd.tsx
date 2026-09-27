import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-4 w-fit min-w-4 items-center justify-center rounded-xs bg-accent px-1 font-sans ui-text-caption font-medium leading-none text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3",
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
      className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
