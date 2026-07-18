import { type Icon as AppIcon } from "@/ui/icons";
import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef, useEffect, useRef } from "react";
import {
  controlIconSizes,
  controlSizeVariants,
  controlSurfaceVariants,
} from "@/utils/control-variants";
import { cn } from "@/utils/cn";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "xs" | "sm" | "md";
  variant?: "default" | "ghost" | "inline";
  leftIcon?: AppIcon;
  rightIcon?: AppIcon;
  containerClassName?: string;
}

const inputVariants = cva(
  [
    "w-full disabled:cursor-not-allowed disabled:opacity-50",
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
    "placeholder:text-text-lighter",
  ],
  {
    variants: {
      variant: {
        default: "",
        ghost: "",
        inline: "",
      },
      size: {
        xs: "",
        sm: "",
        md: "",
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
      { size: "xs", hasLeftIcon: true, className: "pl-6 pr-2 py-1" },
      { size: "xs", hasRightIcon: true, className: "pl-2 pr-6 py-1" },
      { size: "xs", hasLeftIcon: false, hasRightIcon: false, className: "px-2 py-1" },
      { size: "sm", hasLeftIcon: true, className: "pl-7 pr-2 py-1" },
      { size: "sm", hasRightIcon: true, className: "pl-2 pr-7 py-1" },
      { size: "sm", hasLeftIcon: false, hasRightIcon: false, className: "px-2 py-1" },
      { size: "md", hasLeftIcon: true, className: "pl-9 pr-3 py-1" },
      { size: "md", hasRightIcon: true, className: "pl-3 pr-9 py-1" },
      { size: "md", hasLeftIcon: false, hasRightIcon: false, className: "px-3 py-1" },
    ],
    defaultVariants: {
      size: "sm",
      variant: "default",
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
      default: "text-text",
      muted: "text-text-lighter focus:text-text",
    },
    width: {
      full: "w-full",
      content: "w-auto min-w-[1ch] max-w-full [field-sizing:content]",
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
    size = "sm",
    variant = "default",
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
  const iconSizes = {
    xs: controlIconSizes.xs,
    sm: controlIconSizes.sm,
    md: controlIconSizes.md,
  };

  const iconPositions = {
    xs: "left-1.5",
    sm: "left-2",
    md: "left-2.5",
  };

  const iconPositionsRight = {
    xs: "right-1.5",
    sm: "right-2",
    md: "right-2.5",
  };
  const hasLeftIcon = Boolean(LeftIcon);
  const hasRightIcon = Boolean(RightIcon);

  if (!LeftIcon && !RightIcon) {
    return (
      <input
        ref={ref}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        className={cn(
          controlSurfaceVariants({ variant }),
          controlSizeVariants({ size }),
          inputVariants({ size, variant, hasLeftIcon, hasRightIcon }),
          className,
        )}
        {...props}
      />
    );
  }

  return (
    <div className={cn("relative", containerClassName)}>
      {LeftIcon && (
        <LeftIcon
          className={cn("-translate-y-1/2 absolute top-1/2 text-text-lighter", iconPositions[size])}
          size={iconSizes[size]}
        />
      )}
      <input
        ref={ref}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        className={cn(
          controlSurfaceVariants({ variant }),
          controlSizeVariants({ size }),
          inputVariants({ size, variant, hasLeftIcon, hasRightIcon }),
          className,
        )}
        {...props}
      />
      {RightIcon && (
        <RightIcon
          className={cn(
            "-translate-y-1/2 absolute top-1/2 text-text-lighter",
            iconPositionsRight[size],
          )}
          size={iconSizes[size]}
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
  size = "xs",
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
      size={size}
      className={cn(inlineRenameInputVariants({ appearance, tone, width }), className)}
      {...props}
    />
  );
}

export default Input;
