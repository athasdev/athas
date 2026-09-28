import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

const cardVariants = cva(
  "group/card flex flex-col overflow-hidden rounded-lg font-sans ui-text-sm text-foreground",
  {
    variants: {
      variant: {
        /** A panel with a hairline edge, so it reads on either plane. */
        default: "border border-border",
        /** Edge only, for grouping content that stays on the current plane. */
        outline: "border border-border",
        /** A `default` card that responds to hover and focus. */
        interactive:
          "border border-border cursor-default transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
      },
      /**
       * The plane the card fill comes from. `surface` suits cards on the content plane;
       * `background` raises cards off a surface page, such as Settings.
       */
      plane: {
        surface: "bg-surface",
        background: "bg-background",
      },
      layout: {
        /** Header, content, and footer spaced apart. */
        stack: "gap-3 py-3",
        /**
         * Rows split by hairlines inset from the card edge, such as a section of settings. Each
         * row owns its padding; the card owns the edge and the lines between rows.
         */
        list: "*:relative *:not-first:before:pointer-events-none *:not-first:before:absolute *:not-first:before:inset-x-3 *:not-first:before:top-0 *:not-first:before:h-px *:not-first:before:bg-border",
      },
      tone: {
        default: "",
        /** Tinted with the primary colour, for a callout or a plan. */
        accent: "border-primary bg-primary-soft",
      },
    },
    compoundVariants: [{ variant: "outline", class: "bg-transparent" }],
    defaultVariants: {
      variant: "default",
      plane: "surface",
      layout: "stack",
      tone: "default",
    },
  },
);

function Card({
  className,
  variant = "default",
  layout = "stack",
  tone = "default",
  plane = "surface",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      data-tone={tone}
      className={cn(cardVariants({ variant, layout, tone, plane }), className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "grid auto-rows-min items-start gap-1 px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
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
      className={cn("leading-normal text-muted-foreground", className)}
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
  return <div data-slot="card-content" className={cn("px-3", className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center border-border border-t px-3 pt-3", className)}
      {...props}
    />
  );
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
