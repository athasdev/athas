import type { HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";
import { buttonVariantClassName } from "@/ui/button";
import { cn } from "@/utils/cn";

export interface TabProps extends HTMLAttributes<HTMLDivElement> {
  isActive: boolean;
  isDragged?: boolean;
  maxWidth?: number;
  action?: ReactNode;
  size?: "sm" | "md";
  children: ReactNode;
}

export const Tab = forwardRef<HTMLDivElement, TabProps>(function Tab(
  {
    isActive,
    isDragged = false,
    maxWidth = 290,
    action,
    size = "md",
    children,
    className,
    style,
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "group relative shrink-0 cursor-pointer select-none whitespace-nowrap rounded-md transition-[transform,opacity,color,background-color,box-shadow,outline-color] duration-200 ease-[ease]",
        size === "sm"
          ? "flex h-5 items-center gap-1 px-4 text-xs"
          : "flex h-7 items-center gap-1 pr-6 pl-2.5",
        buttonVariantClassName(isActive ? "subtle" : "ghost"),
        isActive ? "text-text" : "text-text-lighter/90",
        isDragged ? "opacity-30" : "opacity-100",
        className,
      )}
      style={{ maxWidth, ...style }}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
      {action}
    </div>
  );
});
