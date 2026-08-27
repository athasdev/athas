import { type Icon as AppIcon } from "@/ui/icons";
import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef, useEffect, useRef } from "react";
import { cn } from "@/utils/cn";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  variant?: "default" | "ghost" | "inline";
  shape?: "default" | "pill";
  leftIcon?: AppIcon;
  rightIcon?: AppIcon;
  containerClassName?: string;
}

const inputVariants = cva(
  [
    "h-7 w-full min-w-0 font-sans ui-text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color,color] duration-fast ease-smooth disabled:cursor-not-allowed disabled:opacity-50",
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
    "placeholder:text-subtle-foreground",
  ],
  {
    variants: {
      variant: {
        default:
          "rounded-chrome border-0 bg-surface focus:border-0 focus:bg-surface focus:ring-1 focus:ring-border-strong/35",
        ghost: "border-none bg-transparent focus:ring-0",
        inline:
          "rounded-none border-0 border-foreground border-b bg-transparent focus:border-subtle-foreground focus:ring-0",
      },
      shape: {
        default: "",
        pill: "rounded-full",
      },
      hasLeftIcon: {
        true: "",
        false: "",
      },
      hasRightIcon: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      { hasLeftIcon: true, className: "py-1 pr-2 pl-7" },
      { hasRightIcon: true, className: "py-1 pr-7 pl-2" },
      { hasLeftIcon: false, hasRightIcon: false, className: "px-2 py-1" },
    ],
    defaultVariants: {
      variant: "default",
      shape: "default",
      hasLeftIcon: false,
      hasRightIcon: false,
    },
  },
);

const inlineRenameInputVariants = cva("font-sans ui-text-sm", {
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
      full: "w-full",
      content: "w-auto min-w-[1ch] max-w-full field-sizing-content",
    },
  },
  defaultVariants: {
    appearance: "inline",
    tone: "default",
    width: "full",
  },
});

type InlineRenameInputProps = Omit<
  InputProps,
  "onBlur" | "onChange" | "onKeyDown" | "onSubmit" | "value" | "variant"
> & {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  allowEmpty?: boolean;
  appearance?: "inline" | "field";
  tone?: "default" | "muted";
  width?: "full" | "content";
};

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    variant = "default",
    shape = "default",
    className,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    containerClassName,
    autoComplete = "off",
    autoCorrect = "off",
    spellCheck = "false",
    ...props
  },
  ref,
) {
  const hasLeftIcon = Boolean(LeftIcon);
  const hasRightIcon = Boolean(RightIcon);

  if (!LeftIcon && !RightIcon) {
    return (
      <input
        ref={ref}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        className={cn(inputVariants({ variant, shape, hasLeftIcon, hasRightIcon }), className)}
        {...props}
      />
    );
  }

  return (
    <div className={cn("relative", containerClassName)}>
      {LeftIcon && (
        <LeftIcon
          className="-translate-y-1/2 absolute top-1/2 left-2 text-subtle-foreground"
          size={12}
        />
      )}
      <input
        ref={ref}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        className={cn(inputVariants({ variant, shape, hasLeftIcon, hasRightIcon }), className)}
        {...props}
      />
      {RightIcon && (
        <RightIcon
          className="-translate-y-1/2 absolute top-1/2 right-2 text-subtle-foreground"
          size={12}
        />
      )}
    </div>
  );
});

export function InlineRenameInput({
  value,
  onValueChange,
  onSubmit,
  onCancel,
  allowEmpty = false,
  appearance = "inline",
  tone = "default",
  width = "full",
  className,
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
    <Input
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
      variant={appearance === "field" ? "default" : "inline"}
      className={cn(inlineRenameInputVariants({ appearance, tone, width }), className)}
      {...props}
    />
  );
}

export default Input;
