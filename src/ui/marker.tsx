import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/utils/cn";

const markerVariants = cva(
  "group/marker relative flex min-h-4 w-full items-center gap-2 text-left font-sans ui-text-sm text-text-lighter outline-none [&_svg:not([class*='size-'])]:size-4 [a]:underline [a]:underline-offset-3 [a]:hover:text-text [button]:cursor-pointer [button]:rounded-md [button]:hover:text-text [button]:focus-visible:ring-2 [button]:focus-visible:ring-accent/20",
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
        accent: "text-accent",
        error: "text-error",
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

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn("flex size-4 shrink-0 items-center justify-center", className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        "min-w-0 break-words group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-text",
        className,
      )}
      {...props}
    />
  );
}

export { Marker, MarkerContent, MarkerIcon, markerVariants };
