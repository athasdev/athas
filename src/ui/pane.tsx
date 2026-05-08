import { Button, type ButtonProps, buttonVariants } from "@/ui/button";
import { cn } from "@/utils/cn";

export const PANE_HEADER_BASE = "flex min-h-7 items-center gap-1.5 bg-primary-bg px-1.5 py-1";

export const PANE_TITLE_BASE = "ui-font ui-text-sm font-medium text-text";

export const PANE_CHIP_BASE =
  "ui-font ui-text-sm inline-flex h-5 items-center rounded-md border border-border/70 bg-primary-bg px-1.5 text-text-lighter";

export const PANE_ICON_BUTTON_BASE = cn(
  buttonVariants({
    variant: "default",
    compact: true,
  }),
  "shrink-0 rounded-lg text-text-lighter",
);

export const PANE_GROUP_BASE = "flex items-center gap-1";

export function paneHeaderClassName(className?: string) {
  return cn(PANE_HEADER_BASE, className);
}

export function paneTitleClassName(className?: string) {
  return cn(PANE_TITLE_BASE, className);
}

export function paneChipClassName(className?: string) {
  return cn(PANE_CHIP_BASE, className);
}

export type PaneIconButtonProps = Omit<ButtonProps, "variant" | "compact">;

export function PaneIconButton({ className, ...props }: PaneIconButtonProps) {
  return (
    <Button
      variant="default"
      compact
      className={cn("shrink-0 rounded-lg text-text-lighter", className)}
      {...props}
    />
  );
}
