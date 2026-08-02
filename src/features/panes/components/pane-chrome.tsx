import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Button, type ButtonProps } from "@/ui/button";
import { cn } from "@/utils/cn";

const paneHeaderVariants = cva("flex min-h-7 items-center gap-1.5 bg-background px-1.5 py-1");

const paneTitleVariants = cva("font-sans ui-text-sm font-medium text-foreground");

const paneChipVariants = cva(
  "font-sans ui-text-sm inline-flex h-5 items-center rounded-full border border-border/70 bg-background px-1.5 text-subtle-foreground",
);

type PaneChipProps = React.ComponentProps<"span"> & VariantProps<typeof paneChipVariants>;

function PaneChip({ className, ...props }: PaneChipProps) {
  return <span data-slot="pane-chip" className={cn(paneChipVariants({ className }))} {...props} />;
}

export function paneHeaderClassName(className?: string) {
  return paneHeaderVariants({ className });
}

export function paneTitleClassName(className?: string) {
  return paneTitleVariants({ className });
}

function paneIconButtonClassName(className?: string) {
  return cn("shrink-0 rounded-md text-subtle-foreground", className);
}

type PaneIconButtonProps = Omit<ButtonProps, "variant" | "size">;

function PaneIconButton({ className, ...props }: PaneIconButtonProps) {
  return (
    <Button
      variant="default"
      size="icon-xs"
      className={paneIconButtonClassName(className)}
      {...props}
    />
  );
}

export { PaneChip, PaneIconButton };
