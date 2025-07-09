import type React from "react";
import { cn } from "../../utils/cn";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline" | "vim";
  size?: "xs" | "sm" | "md" | "lg";
  children: React.ReactNode;
}

export default function Button({
  variant = "default",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  const baseClasses =
    "inline-flex items-center justify-center font-mono font-medium transition-all duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed rounded-md";

  const variants = {
    default: "bg-[var(--hover-color)] text-[var(--text-color)] hover:bg-[var(--selected-color)]",
    ghost: "bg-transparent text-[var(--text-color)] hover:bg-[var(--hover-color)]",
    outline: "bg-transparent text-[var(--text-color)] hover:bg-[var(--hover-color)]",
    vim: "bg-transparent text-[var(--text-color)] hover:bg-[var(--hover-color)] data-[active=true]:bg-blue-500/20 data-[active=true]:text-blue-600 data-[active=true]:border-blue-500/30",
  };

  const sizes = {
    xs: "px-1.5 py-0.5 text-xs h-6 min-w-[24px]",
    sm: "px-2 py-1 text-xs h-7 min-w-[28px]",
    md: "px-3 py-1.5 text-sm h-8",
    lg: "px-4 py-2 text-base h-10",
  };

  return (
    <button className={cn(baseClasses, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  );
}
