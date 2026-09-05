import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/utils/cn";

export const Composer = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & { dragActive?: boolean }
>(function Composer({ className, dragActive = false, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="composer"
      data-drag-active={dragActive || undefined}
      className={cn(
        "relative min-w-0 shrink-0 rounded-xl border border-border/60 bg-(image:--composer-background) text-foreground transition-[border-color,box-shadow] duration-fast focus-within:border-border-strong focus-within:ring-1 focus-within:ring-border-strong/20 data-[drag-active=true]:border-primary data-[drag-active=true]:ring-2 data-[drag-active=true]:ring-primary/20",
        className,
      )}
      {...props}
    />
  );
});

export const ComposerEditable = forwardRef<
  HTMLDivElement,
  ComponentProps<"div"> & { enabled?: boolean }
>(function ComposerEditable({ className, enabled = true, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="composer-editable"
      aria-disabled={!enabled || undefined}
      className={cn(
        "max-h-48 min-h-12 w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-3 pt-3 pb-2 text-left font-sans ui-text-base leading-relaxed text-foreground outline-none empty:before:pointer-events-none empty:before:text-subtle-foreground empty:before:content-[attr(data-placeholder)]",
        enabled ? "cursor-text" : "cursor-not-allowed opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export function ComposerToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-toolbar"
      className={cn("flex min-w-0 flex-wrap items-center gap-2 px-2 pb-2", className)}
      {...props}
    />
  );
}
