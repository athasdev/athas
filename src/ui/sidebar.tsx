import { type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/ui/button";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";

export function SidebarHeader({
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 flex h-8 shrink-0 select-none items-center gap-1.5 bg-primary-bg/95 px-1.5 py-1 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export const SidebarHeaderSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<typeof Input>, "onChange" | "value" | "size" | "variant"> & {
    value: string;
    onChange: (value: string) => void;
    leftIcon: PhosphorIcon;
  }
>(function SidebarHeaderSearch(
  { value, onChange, leftIcon, placeholder = "Search", className, containerClassName, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      leftIcon={leftIcon}
      variant="ghost"
      size="xs"
      placeholder={placeholder}
      className={cn("h-6 rounded-md border-transparent bg-transparent select-text", className)}
      containerClassName={cn("min-w-0 flex-1", containerClassName)}
      {...props}
    />
  );
});

export const SidebarHeaderIconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "variant" | "compact">
>(function SidebarHeaderIconButton({ className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      compact
      className={cn("size-6 rounded-md p-0", className)}
      {...props}
    />
  );
});

export function SidebarEmptyState({
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "ui-font ui-text-sm flex min-h-24 select-none items-center justify-center px-3 py-6 text-center text-text-lighter",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
