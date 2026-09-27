import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/** Selectable, wrapped text in a bordered box: tool output, commands, previews. */
const codeOutputVariants = cva(
  "min-w-0 overflow-auto rounded-lg border border-border bg-surface px-2.5 py-2 whitespace-pre-wrap wrap-anywhere select-text ui-text-sm",
  {
    variants: {
      tone: {
        /** Content the user is asked to read or approve. */
        default: "text-foreground",
        /** Output that supports the surrounding text, such as a tool result. */
        muted: "text-subtle-foreground",
        error: "text-destructive",
      },
      font: {
        mono: "font-mono",
        sans: "font-sans",
      },
      height: {
        /** Grows with its content. */
        auto: "",
        /** Scrolls past a tall block of output. */
        default: "max-h-64",
        /** Scrolls past a short preview, such as a command. */
        compact: "max-h-48",
      },
    },
    defaultVariants: {
      tone: "default",
      font: "mono",
      height: "default",
    },
  },
);

function CodeOutput({
  className,
  tone,
  font,
  height,
  ...props
}: ComponentProps<"pre"> & VariantProps<typeof codeOutputVariants>) {
  return (
    <pre
      data-slot="code-output"
      className={cn(codeOutputVariants({ tone, font, height }), className)}
      {...props}
    />
  );
}

export { CodeOutput, codeOutputVariants };
