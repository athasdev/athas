import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Button, type ButtonProps } from "@/ui/button";
import { cn } from "@/utils/cn";

const paneHeaderVariants = cva("flex min-h-7 items-center gap-1.5 bg-primary-bg px-1.5 py-1");

const paneTitleVariants = cva("ui-font ui-text-sm font-medium text-text");

const paneChipVariants = cva(
  "ui-font ui-text-sm inline-flex h-5 items-center rounded-md border border-border/70 bg-primary-bg px-1.5 text-text-lighter",
);

const paneGroupVariants = cva("flex items-center gap-1");

type PaneHeaderProps = React.ComponentProps<"div"> & VariantProps<typeof paneHeaderVariants>;

function PaneHeader({ className, ...props }: PaneHeaderProps) {
  return (
    <div data-slot="pane-header" className={cn(paneHeaderVariants({ className }))} {...props} />
  );
}

type PaneTitleProps = React.ComponentProps<"span"> & VariantProps<typeof paneTitleVariants>;

function PaneTitle({ className, ...props }: PaneTitleProps) {
  return (
    <span data-slot="pane-title" className={cn(paneTitleVariants({ className }))} {...props} />
  );
}

type PaneChipProps = React.ComponentProps<"span"> & VariantProps<typeof paneChipVariants>;

function PaneChip({ className, ...props }: PaneChipProps) {
  return <span data-slot="pane-chip" className={cn(paneChipVariants({ className }))} {...props} />;
}

type PaneGroupProps = React.ComponentProps<"div"> & VariantProps<typeof paneGroupVariants>;

function PaneGroup({ className, ...props }: PaneGroupProps) {
  return <div data-slot="pane-group" className={cn(paneGroupVariants({ className }))} {...props} />;
}

export function paneHeaderClassName(className?: string) {
  return paneHeaderVariants({ className });
}

export function paneTitleClassName(className?: string) {
  return paneTitleVariants({ className });
}

export function paneChipClassName(className?: string) {
  return paneChipVariants({ className });
}

export function paneGroupClassName(className?: string) {
  return paneGroupVariants({ className });
}

export function paneIconButtonClassName(className?: string) {
  return cn("shrink-0 rounded-lg text-text-lighter", className);
}

export type PaneIconButtonProps = Omit<ButtonProps, "variant" | "compact">;

function PaneIconButton({ className, ...props }: PaneIconButtonProps) {
  return (
    <Button variant="default" compact className={paneIconButtonClassName(className)} {...props} />
  );
}

export { PaneChip, PaneGroup, PaneHeader, PaneIconButton, PaneTitle };
