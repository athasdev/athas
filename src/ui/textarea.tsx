import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef } from "react";
import { cn } from "@/utils/cn";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "ghost";
  inset?: "default" | "flush";
}

const textareaVariants = cva(
  "w-full min-w-0 resize-y rounded-chrome font-sans ui-text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color,color] duration-fast ease-smooth placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-border bg-surface focus:border-border-strong focus:bg-surface focus:ring-1 focus:ring-border-strong/35",
        ghost: "border-none bg-transparent focus:ring-0",
      },
      inset: {
        default: "px-2 py-1",
        flush: "p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      inset: "default",
    },
  },
);

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    variant = "default",
    inset = "default",
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
      className={cn(textareaVariants({ variant, inset }), className)}
      {...props}
    />
  );
});

export default Textarea;
