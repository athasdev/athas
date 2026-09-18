import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef, useEffect, useRef } from "react";
import type { Icon } from "@/ui/icons";
import { cn } from "@/utils/cn";

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "className" | "style"
> {
  className?: never;
  style?: never;
  containerClassName?: never;
  /**
   * - `default` — a bordered field on the surface plane
   * - `ghost` — no box; for a search row inside a menu or popover header
   * - `inline` — an underline only; for renaming in place
   * - `title` — bare heading-sized text; for editing a document title
   */
  variant?: "default" | "ghost" | "inline" | "title";
  size?: "sm" | "md";
  align?: "start" | "center";
  grow?: boolean;
  reserveEndSpace?: boolean;
  leftIcon?: Icon;
  rightIcon?: Icon;
  font?: "default" | "mono" | "inherit";
}

const inputVariants = cva(
  "w-full min-w-0 rounded-md px-2 py-1 ui-text-sm text-foreground outline-none transition-[box-shadow,background-color,border-color,color] duration-fast ease-smooth placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none aria-invalid:border-destructive aria-invalid:focus:border-destructive aria-invalid:focus:ring-destructive-soft",
  {
    variants: {
      font: {
        default: "font-sans",
        mono: "font-mono",
        inherit: "[font-family:inherit] [font-size:inherit]",
      },
      variant: {
        default:
          "border border-border bg-surface focus:border-primary focus:ring-2 focus:ring-focus",
        ghost: "border-0 bg-transparent",
        inline:
          "rounded-none border-0 border-b border-border-strong bg-transparent px-0 focus:border-primary",
        title: "border-0 bg-transparent px-0 font-semibold leading-normal ui-text-base",
      },
      size: { sm: "h-chrome-control", md: "h-7" },
      align: { start: "text-left", center: "text-center" },
      grow: { true: "flex-1", false: "" },
      hasLeftIcon: { true: "pl-7", false: "" },
      hasRightIcon: { true: "pr-8", false: "" },
    },
    compoundVariants: [{ variant: "title", className: "h-auto" }],
    defaultVariants: {
      variant: "default",
      font: "default",
      size: "md",
      align: "start",
    },
  },
);

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    variant,
    size,
    align,
    grow,
    reserveEndSpace,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    font,
    autoComplete = "off",
    autoCorrect = "off",
    spellCheck = false,
    ...props
  },
  ref,
) {
  const field = (
    <input
      {...props}
      ref={ref}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect}
      spellCheck={spellCheck}
      style={undefined}
      className={cn(
        inputVariants({
          variant,
          size,
          align,
          grow,
          font,
          hasLeftIcon: !!LeftIcon,
          hasRightIcon: !!RightIcon || reserveEndSpace,
        }),
      )}
    />
  );
  if (!LeftIcon && !RightIcon) return field;
  return (
    <div className={cn("relative w-full min-w-0", grow && "flex-1")}>
      {LeftIcon && (
        <LeftIcon
          className="pointer-events-none -translate-y-1/2 absolute top-1/2 left-2 text-subtle-foreground"
          size={12}
        />
      )}
      {field}
      {RightIcon && (
        <RightIcon
          className="pointer-events-none -translate-y-1/2 absolute top-1/2 right-2 text-subtle-foreground"
          size={12}
        />
      )}
    </div>
  );
});

const inlineRenameInputVariants = cva(
  "relative z-1 max-w-full select-text text-left font-sans ui-text-sm",
  {
    variants: {
      appearance: {
        inline: "px-0",
        field: "",
      },
      tone: {
        default: "text-foreground",
        muted: "text-subtle-foreground focus:text-foreground",
      },
      width: {
        full: "w-full flex-1",
        content: "w-auto min-w-[1ch] field-sizing-content",
      },
    },
    defaultVariants: {
      appearance: "inline",
      tone: "default",
      width: "full",
    },
  },
);

type InlineRenameInputProps = Omit<
  InputProps,
  | "onBlur"
  | "onChange"
  | "onKeyDown"
  | "onSubmit"
  | "value"
  | "variant"
  | "className"
  | "style"
  | "font"
  | "leftIcon"
  | "rightIcon"
  | "size"
  | "align"
  | "grow"
  | "reserveEndSpace"
> & {
  className?: never;
  style?: never;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  allowEmpty?: boolean;
  appearance?: "inline" | "field";
  tone?: "default" | "muted";
  width?: "full" | "content";
};

export function InlineRenameInput({
  value,
  onValueChange,
  onSubmit,
  onCancel,
  allowEmpty = false,
  appearance = "inline",
  tone = "default",
  width = "full",
  ...props
}: InlineRenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frameId);
  }, []);

  const submit = () => {
    if (finishedRef.current) return;

    const nextValue = value.trim();
    if (!allowEmpty && !nextValue) {
      finishedRef.current = true;
      onCancel();
      return;
    }

    finishedRef.current = true;
    onSubmit(nextValue);
  };

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  return (
    <input
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      ref={inputRef}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      className={cn(
        inputVariants({ variant: appearance === "field" ? "default" : "inline" }),
        inlineRenameInputVariants({ appearance, tone, width }),
      )}
      {...props}
    />
  );
}

export default Input;
