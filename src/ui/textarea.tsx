import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef } from "react";
import { controlSurfaceVariants } from "@/utils/control-variants";
import { cn } from "@/utils/cn";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: "sm" | "md";
  variant?: "default" | "ghost";
}

const textareaVariants = cva("w-full resize-y placeholder:text-subtle-foreground", {
  variants: {
    size: {
      sm: "px-2 py-1 ui-text-sm",
      md: "px-3 py-2 ui-text-base",
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    size = "sm",
    variant = "default",
    className,
    autoComplete = "off",
    autoCorrect = "off",
    spellCheck = "false",
    ...props
  },
  ref,
) {
  return (
    <textarea
      ref={ref}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      spellCheck={spellCheck}
      className={cn(controlSurfaceVariants({ variant }), textareaVariants({ size }), className)}
      {...props}
    />
  );
});

export default Textarea;
