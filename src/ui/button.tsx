import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { cn } from "@/utils/cn";

export type ButtonVariant = "default" | "ghost" | "outline" | "subtle" | "danger" | "vim";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon-xs" | "icon-sm" | "icon-md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  children: ReactNode;
}

export const BUTTON_BASE_CLASS =
  "inline-flex items-center justify-center ui-font font-medium transition-all duration-150 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: "rounded-md bg-hover text-text hover:bg-selected",
  ghost:
    "rounded-md border border-transparent bg-transparent text-text-lighter hover:bg-hover hover:text-text data-[active=true]:bg-hover data-[active=true]:text-text",
  outline:
    "rounded-md border border-border/70 bg-transparent text-text hover:bg-hover data-[active=true]:bg-hover",
  subtle:
    "rounded-md border border-transparent bg-primary-bg/45 text-text-lighter hover:border-border/60 hover:bg-hover/80 hover:text-text data-[active=true]:border-border/60 data-[active=true]:bg-hover/80 data-[active=true]:text-text",
  danger:
    "rounded-md border border-transparent bg-transparent text-text-lighter hover:border-error/40 hover:bg-error/90 hover:text-white data-[active=true]:border-error/40 data-[active=true]:bg-error/90 data-[active=true]:text-white",
  vim: "rounded-md border border-transparent bg-transparent text-text hover:bg-hover data-[active=true]:border-blue-500/30 data-[active=true]:bg-blue-500/20 data-[active=true]:text-blue-600",
};

export const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  xs: "h-6 min-w-[24px] px-1.5 py-0.5 text-xs",
  sm: "h-7 min-w-[28px] px-2 py-1 text-xs",
  md: "h-8 px-3 py-1.5 text-sm",
  lg: "h-10 px-4 py-2 text-base",
  "icon-xs": "h-5 w-5 p-0 text-xs",
  "icon-sm": "h-6 w-6 p-0 text-xs",
  "icon-md": "h-7 w-7 p-0 text-sm",
};

export function buttonVariantClassName(variant: ButtonVariant = "default") {
  return BUTTON_VARIANT_CLASS[variant];
}

export function buttonSizeClassName(size: ButtonSize = "md") {
  return BUTTON_SIZE_CLASS[size];
}

export function buttonClassName({
  variant = "default",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return cn(
    BUTTON_BASE_CLASS,
    buttonVariantClassName(variant),
    buttonSizeClassName(size),
    className,
  );
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "md", active, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={buttonClassName({ variant, size, className })}
        data-active={active}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";

export default Button;
