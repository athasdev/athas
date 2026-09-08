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
  variant?: "default" | "ghost" | "inline" | "bare" | "group" | "title";
  shape?: "default" | "pill";
  size?: "default" | "compact";
  align?: "start" | "center";
  grow?: boolean;
  reserveEndSpace?: boolean;
  leftIcon?: Icon;
  rightIcon?: Icon;
  font?: "default" | "mono" | "inherit";
}

const inputVariants = cva(
  "w-full min-w-0 px-2 py-1 ui-text-sm text-foreground outline-none transition-[box-shadow,background-color,color] duration-fast ease-smooth disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none placeholder:text-subtle-foreground aria-invalid:ring-1 aria-invalid:ring-destructive/45 aria-invalid:focus:ring-destructive/45",
  {
    variants: {
      font: {
        default: "font-sans",
        mono: "font-mono",
        inherit: "[font-family:inherit] [font-size:inherit]",
      },
      variant: {
        default:
          "rounded-chrome border-0 bg-surface focus:bg-surface focus:ring-1 focus:ring-border-strong/35",
        ghost: "border-none bg-transparent focus:ring-0",
        inline:
          "rounded-none border-0 border-foreground border-b bg-transparent focus:border-subtle-foreground focus:ring-0",
        bare: "rounded-none border-0 bg-transparent px-0 focus:ring-0",
        group: "rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0",
        title:
          "rounded-none border-0 bg-transparent px-0 font-semibold leading-normal ui-text-base focus:ring-0",
      },
      shape: { default: "", pill: "rounded-full" },
      size: { default: "h-7", compact: "h-6" },
      align: { start: "text-left", center: "text-center" },
      grow: { true: "flex-1", false: "" },
      hasLeftIcon: { true: "pl-7", false: "" },
      hasRightIcon: { true: "pr-8", false: "" },
    },
    compoundVariants: [{ variant: "title", className: "h-auto" }],
    defaultVariants: {
      variant: "default",
      shape: "default",
      font: "default",
      size: "default",
      align: "start",
    },
  },
);

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    variant,
    shape,
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
          shape,
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
  | "shape"
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
