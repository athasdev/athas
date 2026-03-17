import type { LucideIcon } from "lucide-react";
import type React from "react";
import { forwardRef } from "react";
import { cn } from "@/utils/cn";

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "xs" | "sm" | "md";
  variant?: "default" | "ghost";
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  containerClassName?: string;
}

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
  const sizeClasses = {
    xs: "h-6 text-xs",
    sm: "h-7 text-xs",
    md: "h-8 text-sm",
  };

  const paddingClasses = {
    xs: LeftIcon ? "pl-6 pr-2" : RightIcon ? "pl-2 pr-6" : "px-2",
    sm: LeftIcon ? "pl-7 pr-2" : RightIcon ? "pl-2 pr-7" : "px-2",
    md: LeftIcon ? "pl-9 pr-3" : RightIcon ? "pl-3 pr-9" : "px-3",
  };

  const iconSizes = {
    xs: "var(--app-ui-icon-size-sm)",
    sm: "var(--app-ui-icon-size-sm)",
    md: "var(--app-ui-icon-size-md)",
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

  const variantClasses = {
    default: cn(
      "rounded-lg border border-border bg-secondary-bg text-text transition-[border-color,box-shadow,background-color]",
      "focus:border-border-strong focus:bg-secondary-bg focus:outline-none focus:ring-1 focus:ring-border-strong/35",
    ),
    ghost: "border-none bg-transparent text-text focus:outline-none focus:ring-0",
  };

  const sharedClasses = cn(
    "w-full disabled:cursor-not-allowed disabled:opacity-50",
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
    "placeholder:text-text-lighter",
  );

  if (!LeftIcon && !RightIcon) {
    return (
      <input
        ref={ref}
        className={cn(
          sharedClasses,
          variantClasses[variant],
          "px-2 py-1",
          sizeClasses[size],
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
          sharedClasses,
          variantClasses[variant],
          "py-1",
          paddingClasses[size],
          sizeClasses[size],
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
