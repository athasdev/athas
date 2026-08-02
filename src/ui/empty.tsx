import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

const emptyVariants = cva(
  "group/empty flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center border-dashed text-center",
  {
    variants: {
      density: {
        default: "gap-4 rounded-xl p-6",
        compact: "gap-2 rounded-lg p-3",
      },
      tone: {
        neutral: "",
        error: "",
        warning: "",
        success: "",
      },
    },
    defaultVariants: {
      density: "default",
      tone: "neutral",
    },
  },
);

function Empty({
  className,
  density = "default",
  tone = "neutral",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof emptyVariants>) {
  return (
    <div
      data-slot="empty"
      data-density={density}
      data-tone={tone}
      className={cn(emptyVariants({ density, tone }), className)}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  "mb-1 flex shrink-0 items-center justify-center group-data-[tone=error]/empty:text-destructive group-data-[tone=success]/empty:text-success group-data-[tone=warning]/empty:text-warning [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "size-8 rounded-lg bg-accent text-foreground [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant }), className)}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "font-sans ui-text-base font-medium tracking-tight text-foreground group-data-[tone=error]/empty:text-destructive group-data-[tone=success]/empty:text-success group-data-[tone=warning]/empty:text-warning",
        className,
      )}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn(
        "font-sans ui-text-sm leading-relaxed text-subtle-foreground group-data-[tone=error]/empty:text-destructive group-data-[tone=success]/empty:text-success group-data-[tone=warning]/empty:text-warning [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 font-sans ui-text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle };
