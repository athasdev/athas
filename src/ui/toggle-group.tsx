import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export interface ToggleGroupOption<Value extends string = string> {
  value: Value;
  label: string;
  icon?: ReactNode;
}

interface ToggleGroupCommonProps<Value extends string> {
  options: ToggleGroupOption<Value>[];
  ariaLabel: string;
  size?: "xs" | "sm" | "md";
  variant?: "default" | "segmented";
  className?: string;
  wrap?: boolean;
  iconOnly?: boolean;
}

interface SingleToggleGroupProps<Value extends string> extends ToggleGroupCommonProps<Value> {
  type?: "single";
  value: Value;
  onValueChange: (value: Value) => void;
}

interface MultipleToggleGroupProps<Value extends string> extends ToggleGroupCommonProps<Value> {
  type: "multiple";
  value: Value[];
  onValueChange: (value: Value[]) => void;
}

const toggleGroupVariants = cva(
  "inline-flex max-w-full items-stretch self-start rounded-lg bg-surface/55",
  {
    variants: {
      variant: {
        default: "gap-1 p-1",
        segmented: "gap-0 overflow-hidden p-0",
      },
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
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md font-sans text-subtle-foreground outline-none transition-[transform,background-color,color] duration-(--app-duration-fast) ease-(--app-ease-smooth) hover:bg-accent/50 hover:text-foreground active:scale-(--app-press-scale) focus-visible:ring-2 focus-visible:ring-primary/20 data-disabled:pointer-events-none data-disabled:opacity-50 data-pressed:bg-accent/80 data-pressed:text-foreground",
  {
    variants: {
      size: {
        xs: "min-h-6 px-2.5 ui-text-sm",
        sm: "min-h-7 px-2.5 ui-text-sm",
        md: "min-h-8 px-3 ui-text-base",
      },
      variant: {
        default: "",
        segmented: "rounded-none border-border/60 border-r last:border-r-0",
      },
      iconOnly: {
        true: "aspect-square px-0",
        false: "",
      },
    },
    defaultVariants: {
      size: "xs",
      variant: "default",
      iconOnly: false,
    },
  },
);

export type ToggleGroupProps<Value extends string> =
  | SingleToggleGroupProps<Value>
  | MultipleToggleGroupProps<Value>;

export function ToggleGroup<Value extends string>(props: ToggleGroupProps<Value>) {
  const {
    options,
    ariaLabel,
    size = "xs",
    variant = "default",
    className,
    wrap = true,
    iconOnly = false,
  } = props;
  const values = props.type === "multiple" ? props.value : [props.value];

  return (
    <ToggleGroupPrimitive
      value={values}
      onValueChange={(nextValues) => {
        if (props.type === "multiple") {
          props.onValueChange(nextValues as Value[]);
          return;
        }

        const nextValue = nextValues[0] as Value | undefined;
        if (nextValue) {
          props.onValueChange(nextValue);
        }
      }}
      aria-label={ariaLabel}
      data-slot="toggle-group"
      className={cn(toggleGroupVariants({ variant, wrap }), className)}
    >
      {options.map((option) => {
        const item = (
          <TogglePrimitive
            value={option.value}
            data-slot="toggle-group-item"
            aria-label={iconOnly ? option.label : undefined}
            className={toggleGroupItemVariants({ size, variant, iconOnly })}
          >
            {option.icon}
            {iconOnly ? (
              <span className="sr-only">{option.label}</span>
            ) : (
              <span>{option.label}</span>
            )}
          </TogglePrimitive>
        );

        return iconOnly ? (
          <Tooltip key={option.value} content={option.label}>
            {item}
          </Tooltip>
        ) : (
          <span key={option.value} className="contents">
            {item}
          </span>
        );
      })}
    </ToggleGroupPrimitive>
  );
}
