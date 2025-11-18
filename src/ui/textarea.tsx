import type React from "react";
import { cn } from "@/utils/cn";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: "sm" | "md";
}

export default function Textarea({ size = "sm", className, ...props }: TextareaProps) {
  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-2 text-sm",
  };

  return (
    <textarea
      className={cn(
        "w-full rounded border border-border bg-secondary-bg text-text transition-colors",
        "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "placeholder:text-text-lighter",
        "resize-y",
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
