import type { LucideIcon } from "lucide-react";
import { cva } from "class-variance-authority";
import type React from "react";
import { forwardRef } from "react";
import {
  controlFieldIconSizes,
  controlFieldSizeVariants,
  controlFieldSurfaceVariants,
} from "@/ui/control-field";
import { cn } from "@/utils/cn";

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "xs" | "sm" | "md";
  variant?: "default" | "ghost";
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
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

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    size = "sm",
    variant = "default",
    className,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    containerClassName,
    ...props
  },
  ref,
) {
  const iconSizes = {
    xs: controlFieldIconSizes.xs,
    sm: controlFieldIconSizes.sm,
    md: controlFieldIconSizes.md,
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
        className={cn(
          controlFieldSurfaceVariants({ variant }),
          controlFieldSizeVariants({ size }),
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
        className={cn(
          controlFieldSurfaceVariants({ variant }),
          controlFieldSizeVariants({ size }),
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

export default Input;
