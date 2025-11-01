import type React from "react";
import { cn } from "@/utils/cn";

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "xs" | "sm" | "md";
}

export default function Input({ size = "sm", className, ...props }: InputProps) {
  const sizeClasses = {
    xs: "px-2 py-1 text-xs h-6",
    sm: "px-2 py-1 text-xs h-7",
    md: "px-3 py-1.5 text-sm h-8",
  };

  return (
    <input
      className={cn(
        "rounded border border-border bg-secondary-bg text-text transition-colors",
        "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
