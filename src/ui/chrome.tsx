import type { ComponentProps } from "react";
import type { VariantProps } from "class-variance-authority";
import {
  chromeBarVariants,
  chromeGroupVariants,
  chromeLabelVariants,
} from "@/design-system/chrome";
import { cn } from "@/utils/cn";

export function ChromeBar({
  className,
  region,
  emphasis,
  separated,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof chromeBarVariants>) {
  return (
    <div
      data-slot="chrome-bar"
      data-region={region}
      className={cn(chromeBarVariants({ region, emphasis, separated }), className)}
      {...props}
    />
  );
}

export function ChromeGroup({
  className,
  gap,
  grow,
  align,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof chromeGroupVariants>) {
  return (
    <div
      data-slot="chrome-group"
      className={cn(chromeGroupVariants({ gap, grow, align }), className)}
      {...props}
    />
  );
}

export function ChromeLabel({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof chromeLabelVariants>) {
  return (
    <span
      data-slot="chrome-label"
      className={cn(chromeLabelVariants({ tone }), className)}
      {...props}
    />
  );
}

export function ChromeSeparator({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div
      data-slot="chrome-separator"
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-border/55",
        orientation === "vertical" ? "mx-0.5 h-3.5 w-px" : "my-0.5 h-px w-full",
        className,
      )}
      {...props}
    />
  );
}
