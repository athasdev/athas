import type React from "react";
import { cn } from "@/utils/cn";

interface ToggleProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  size?: "xs" | "sm" | "md";
  variant?: "default" | "outline";
  children: React.ReactNode;
}

export default function Toggle({
  pressed,
  onPressedChange,
  size = "sm",
  variant = "default",
  className,
  children,
  ...props
}: ToggleProps) {
  const baseClasses =
    "inline-flex items-center justify-center font-mono font-medium transition-all duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded select-none";

  const sizes = {
    xs: "px-1 py-1 text-xs h-5 min-w-[20px]",
    sm: "px-1.5 py-1 text-xs h-6 min-w-[24px]",
    md: "px-2 py-1.5 text-sm h-7 min-w-[28px]",
  };

  const variants = {
    default: pressed
      ? "bg-selected text-text border border-border"
      : "bg-transparent text-text-lighter hover:bg-hover hover:text-text border border-transparent",
    outline: pressed
      ? "bg-selected text-text border border-border"
      : "bg-transparent text-text-lighter hover:bg-hover hover:text-text border border-border",
  };

  return (
    <button
      className={cn(baseClasses, variants[variant], sizes[size], className)}
      onClick={() => onPressedChange(!pressed)}
      data-pressed={pressed}
      {...props}
    >
      {children}
    </button>
  );
}
