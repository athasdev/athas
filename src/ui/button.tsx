import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

export const buttonVariants = cva(
  "ui-font inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-[length:var(--app-ui-control-font-size)] leading-none transition-all duration-150 select-none outline-none focus:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-[length:var(--app-ui-control-icon-size)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-hover text-text hover:bg-selected",
        primary:
          "border-blue-500/30 bg-blue-500/20 text-blue-600 hover:bg-blue-500/30 data-[active=true]:border-blue-500/40 data-[active=true]:bg-blue-500/30",
        secondary:
          "bg-primary-bg/45 text-text-lighter hover:border-border/60 hover:bg-hover/80 hover:text-text data-[active=true]:border-border/60 data-[active=true]:bg-hover/80 data-[active=true]:text-text",
        ghost:
          "bg-transparent text-text-lighter hover:bg-hover hover:text-text data-[active=true]:bg-hover data-[active=true]:text-text",
        outline:
          "border-border/70 bg-transparent text-text hover:bg-hover data-[active=true]:bg-hover",
        danger:
          "bg-transparent text-text-lighter hover:border-error/40 hover:bg-error/90 hover:text-white data-[active=true]:border-error/40 data-[active=true]:bg-error/90 data-[active=true]:text-white",
      },
      size: {
        xs: "h-6 min-w-[24px] px-1.5",
        sm: "h-7 min-w-[28px] px-2",
        md: "h-8 px-3",
        lg: "h-10 px-4",
        "icon-xs": "size-5 p-0",
        "icon-sm": "size-6 p-0",
        "icon-md": "size-7 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    active?: boolean;
    asChild?: boolean;
  };

export function Button({
  className,
  variant = "default",
  size = "md",
  active,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-active={active}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
