import { cva } from "class-variance-authority";
import type React from "react";
import { cn } from "@/utils/cn";

interface ToggleProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  size?: "xs" | "sm" | "md";
  variant?: "default" | "outline";
  children: React.ReactNode;
}

const toggleVariants = cva(
  "inline-flex items-center justify-center ui-font font-medium transition-all duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded select-none",
  {
    variants: {
      size: {
        xs: "ui-text-sm h-5 min-w-[20px] px-1 py-1",
        sm: "ui-text-sm h-6 min-w-[24px] px-1.5 py-1",
        md: "ui-text-md h-7 min-w-[28px] px-2 py-1.5",
      },
      variant: {
        default: "border border-transparent",
        outline: "border border-border",
      },
      pressed: {
        true: "bg-selected text-text border-border",
        false: "bg-transparent text-text-lighter hover:bg-hover hover:text-text",
      },
    },
    defaultVariants: {
      size: "sm",
      variant: "default",
      pressed: false,
    },
    compoundVariants: [
      {
        variant: "default",
        pressed: false,
        className: "border-transparent",
      },
    ],
  },
);

export default function Toggle({
  pressed,
  onPressedChange,
  size = "sm",
  variant = "default",
  className,
  children,
  ...props
}: ToggleProps) {
  return (
    <button
      className={cn(toggleVariants({ size, variant, pressed }), className)}
      onClick={() => onPressedChange(!pressed)}
      data-pressed={pressed}
      {...props}
    >
      {children}
    </button>
  );
}
