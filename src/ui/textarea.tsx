import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef, useLayoutEffect, useRef } from "react";
import { cn } from "@/utils/cn";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "ghost";
  inset?: "default" | "flush";
  /** Matches `Input`'s `font` prop, so the two controls stay in step. */
  font?: "default" | "mono" | "inherit";
  /** Whether the user can drag the control taller. */
  resize?: "y" | "none";
  autoSize?: boolean;
}

const textareaVariants = cva(
  "w-full min-w-0 rounded-md ui-text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color,color] duration-fast ease-smooth placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-border bg-surface focus:border-primary focus:ring-2 focus:ring-focus",
        ghost: "border-0 bg-transparent",
      },
      inset: {
        default: "px-2 py-1",
        flush: "p-0",
      },
      font: {
        default: "font-sans",
        mono: "font-mono",
        inherit: "[font-family:inherit] [font-size:inherit] [line-height:inherit]",
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
    autoSize = false,
    className,
    autoComplete = "off",
    autoCorrect = "off",
    spellCheck = "false",
    ...props
  },
  ref,
) {
  const elementRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!autoSize || !element) return;
    const resizeToContent = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
    };
    resizeToContent();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      resizeToContent();
    });
    observer.observe(element);
    element.addEventListener("input", resizeToContent);
    return () => {
      observer.disconnect();
      element.removeEventListener("input", resizeToContent);
      element.style.height = "";
    };
  }, [autoSize, props.value]);

  return (
    <textarea
      ref={(element) => {
        elementRef.current = element;
        if (typeof ref === "function") return ref(element);
        if (ref) ref.current = element;
      }}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      spellCheck={spellCheck}
      className={cn(textareaVariants({ variant, inset, font, resize }), className)}
      {...props}
      rows={autoSize ? 1 : props.rows}
    />
  );
});

export default Textarea;
