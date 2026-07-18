import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface ToggleGroupOption<Value extends string = string> {
  value: Value;
  label: string;
  icon?: ReactNode;
}

interface ToggleGroupProps<Value extends string> {
  value: Value;
  options: ToggleGroupOption<Value>[];
  onValueChange: (value: Value) => void;
  ariaLabel: string;
  size?: "xs" | "sm" | "md";
  className?: string;
  wrap?: boolean;
}

const toggleGroupVariants = cva(
  "inline-flex max-w-full items-stretch gap-1 self-start rounded-lg bg-secondary-bg/55 p-1",
  {
    variants: {
      wrap: {
        true: "h-auto flex-wrap overflow-visible",
        false: "w-fit overflow-hidden",
      },
    },
    defaultVariants: {
      wrap: true,
    },
  },
);

const toggleGroupItemVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md font-sans text-text-lighter outline-none transition-[transform,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:bg-hover/50 hover:text-text active:scale-[var(--app-press-scale)] focus-visible:ring-2 focus-visible:ring-accent/20 data-disabled:pointer-events-none data-disabled:opacity-50 data-pressed:bg-hover/80 data-pressed:text-text",
  {
    variants: {
      size: {
        xs: "min-h-6 px-2.5 ui-text-sm",
        sm: "min-h-7 px-2.5 ui-text-sm",
        md: "min-h-8 px-3 ui-text-base",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  },
);

export function ToggleGroup<Value extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  size = "xs",
  className,
  wrap = true,
}: ToggleGroupProps<Value>) {
  return (
    <ToggleGroupPrimitive
      value={[value]}
      onValueChange={(nextValues) => {
        const nextValue = nextValues[0];
        if (nextValue) {
          onValueChange(nextValue);
        }
      }}
      aria-label={ariaLabel}
      data-slot="toggle-group"
      className={cn(toggleGroupVariants({ wrap }), className)}
    >
      {options.map((option) => (
        <TogglePrimitive
          key={option.value}
          value={option.value}
          data-slot="toggle-group-item"
          className={toggleGroupItemVariants({ size })}
        >
          {option.icon}
          <span>{option.label}</span>
        </TogglePrimitive>
      ))}
    </ToggleGroupPrimitive>
  );
}
