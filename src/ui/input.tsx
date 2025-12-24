import type { LucideIcon } from "lucide-react";
import type React from "react";
import { cn } from "@/utils/cn";

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "xs" | "sm" | "md";
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  containerClassName?: string;
}

export default function Input({
  size = "sm",
  className,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  containerClassName,
  ...props
}: InputProps) {
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
    xs: 12,
    sm: 12,
    md: 14,
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

  if (!LeftIcon && !RightIcon) {
    return (
      <input
        className={cn(
          "rounded border border-border bg-secondary-bg text-text transition-colors",
          "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "placeholder:text-text-lighter",
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
        className={cn(
          "w-full rounded border border-border bg-secondary-bg text-text transition-colors",
          "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "placeholder:text-text-lighter",
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
}
