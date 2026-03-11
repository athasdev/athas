import { ChevronDown, type LucideIcon } from "lucide-react";
import type React from "react";
import { cn } from "@/utils/cn";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  size?: "xs" | "sm" | "md";
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  containerClassName?: string;
}

export default function Select({
  size = "sm",
  className,
  leftIcon: LeftIcon,
  rightIcon: RightIcon = ChevronDown,
  containerClassName,
  children,
  ...props
}: SelectProps) {
  const sizeClasses = {
    xs: "h-6 text-xs",
    sm: "h-7 text-xs",
    md: "h-8 text-sm",
  };

  const paddingClasses = {
    xs: LeftIcon ? "pl-6 pr-6" : "pl-2 pr-6",
    sm: LeftIcon ? "pl-7 pr-7" : "pl-2 pr-7",
    md: LeftIcon ? "pl-9 pr-9" : "pl-3 pr-9",
  };

  const iconSizes = {
    xs: "var(--app-ui-icon-size-sm)",
    sm: "var(--app-ui-icon-size-sm)",
    md: "var(--app-ui-icon-size-md)",
  };

  const leftPositions = {
    xs: "left-1.5",
    sm: "left-2",
    md: "left-2.5",
  };

  const rightPositions = {
    xs: "right-1.5",
    sm: "right-2",
    md: "right-2.5",
  };

  return (
    <div className={cn("relative", containerClassName)}>
      {LeftIcon && (
        <LeftIcon
          className={cn(
            "-translate-y-1/2 pointer-events-none absolute top-1/2 text-text-lighter",
            leftPositions[size],
          )}
          size={iconSizes[size]}
        />
      )}
      <select
        className={cn(
          "ui-font w-full appearance-none rounded-lg border border-border bg-secondary-bg text-text transition-colors",
          "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          paddingClasses[size],
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {RightIcon && (
        <RightIcon
          className={cn(
            "-translate-y-1/2 pointer-events-none absolute top-1/2 text-text-lighter",
            rightPositions[size],
          )}
          size={iconSizes[size]}
        />
      )}
    </div>
  );
}
