import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef } from "react";
import { cn } from "@/utils/cn";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "ghost";
  inset?: "default" | "flush";
  /** Matches `Input`'s `font` prop, so the two controls stay in step. */
  font?: "default" | "mono" | "inherit";
  /** Whether the user can drag the control taller. */
  resize?: "y" | "none";
}

const textareaVariants = cva(
  "w-full min-w-0 rounded-chrome ui-text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color,color] duration-fast ease-smooth placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50",
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
      font: {
        default: "font-sans",
        mono: "font-mono",
        inherit: "[font-family:inherit] [font-size:inherit]",
      },
      resize: {
        y: "resize-y",
        none: "resize-none",
      },
    },
    defaultVariants: {
      variant: "default",
      inset: "default",
      font: "default",
      resize: "y",
    },
  },
);

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    variant = "default",
    inset = "default",
    font = "default",
    resize = "y",
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
      className={cn(textareaVariants({ variant, inset, font, resize }), className)}
      {...props}
    />
  );
});

export default Textarea;
