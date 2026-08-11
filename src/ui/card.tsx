import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

const cardVariants = cva(
  "group/card flex flex-col overflow-hidden rounded-xl font-sans ui-text-sm text-foreground",
  {
    variants: {
      variant: {
        default: "border border-border/70 bg-surface/45",
        muted: "bg-surface/55",
        outline: "border border-border/70 bg-transparent",
        elevated: "bg-surface/65 shadow-(--shadow-card)",
      },
      size: {
        flush: "gap-0 py-0 [--card-spacing:0rem]",
        sm: "gap-3 py-3 [--card-spacing:0.75rem]",
        default: "gap-4 py-4 [--card-spacing:1rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Card({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      className={cn(cardVariants({ variant, size }), className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min items-start gap-1 px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-medium leading-snug text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("leading-normal text-subtle-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
  );
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center border-border/70 border-t bg-surface/55 px-(--card-spacing) pt-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
};
