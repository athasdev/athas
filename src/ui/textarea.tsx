import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef } from "react";
import { cn } from "@/utils/cn";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: "sm" | "md";
  variant?: "default" | "ghost";
}

const textareaVariants = cva(
  "w-full disabled:cursor-not-allowed disabled:opacity-50 placeholder:text-text-lighter resize-y",
  {
    variants: {
      variant: {
        default: cn(
          "rounded border border-border bg-secondary-bg text-text transition-colors",
          "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
        ),
        ghost: "border-none bg-transparent text-text focus:outline-none focus:ring-0",
      },
      size: {
        sm: "px-2 py-1 ui-text-sm",
        md: "px-3 py-2 ui-text-md",
      },
    },
    defaultVariants: {
      size: "sm",
      variant: "default",
    },
  },
);

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size = "sm", variant = "default", className, ...props },
  ref,
) {
  return (
    <textarea ref={ref} className={cn(textareaVariants({ size, variant }), className)} {...props} />
  );
});

export default Textarea;
