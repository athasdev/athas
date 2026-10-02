import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/utils/cn";

const markerVariants = cva(
  "group/marker relative flex min-h-4 w-full items-center gap-2 text-left font-sans ui-text-sm text-subtle-foreground outline-none [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground [button]:rounded-md [button]:hover:text-foreground [button]:focus-visible:ring-2 [button]:focus-visible:ring-focus",
  {
    variants: {
      variant: {
        default: "",
        separator:
          "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border",
        border: "border-b border-border pb-2",
      },
      tone: {
        default: "",
        accent: "text-primary",
        error: "text-destructive",
        success: "text-success",
        warning: "text-warning",
      },
    },
    defaultVariants: {
      variant: "default",
      tone: "default",
    },
  },
);

type MarkerProps = useRender.ComponentProps<"div"> & VariantProps<typeof markerVariants>;

function Marker({
  className,
  variant = "default",
  tone = "default",
  render,
  ref,
  ...props
}: MarkerProps) {
  return useRender({
    defaultTagName: "div",
    render,
    ref,
    props: {
      "data-slot": "marker",
      "data-variant": variant,
      "data-tone": tone,
      className: cn(markerVariants({ variant, tone }), className),
      ...props,
    },
  });
}

const markerIconVariants = cva("flex size-4 shrink-0 items-center justify-center", {
  variants: {
    /** Status colour for the icon alone, when the text beside it stays neutral. */
    tone: {
      default: "",
      accent: "text-primary",
      error: "text-destructive",
      success: "text-success",
      warning: "text-warning",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

function MarkerIcon({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof markerIconVariants>) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn(markerIconVariants({ tone }), className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        "min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

type MarkerIconTone = NonNullable<VariantProps<typeof markerIconVariants>["tone"]>;

export { Marker, MarkerContent, MarkerIcon, markerVariants };
export type { MarkerIconTone };
