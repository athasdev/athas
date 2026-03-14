import type React from "react";
import { forwardRef } from "react";
import { cn } from "@/utils/cn";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: "sm" | "md";
  variant?: "default" | "ghost";
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size = "sm", variant = "default", className, ...props },
  ref,
) {
  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-2 text-sm",
  };

  const variantClasses = {
    default: cn(
      "rounded border border-border bg-secondary-bg text-text transition-colors",
      "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
    ),
    ghost: "border-none bg-transparent text-text focus:outline-none focus:ring-0",
  };

  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full",
        variantClasses[variant],
        "disabled:cursor-not-allowed disabled:opacity-50",
        "placeholder:text-text-lighter",
        "resize-y",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});

export default Textarea;
