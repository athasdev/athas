import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { cva } from "class-variance-authority";
import type React from "react";
import { MinusIcon as Minus, PlusIcon as Plus } from "@/ui/icons";
import { Button } from "@/ui/button";
import {
  controlIconSizes,
  controlSizeVariants,
  controlSurfaceVariants,
} from "@/utils/control-variants";
import { cn } from "@/utils/cn";

interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "defaultValue" | "max" | "min" | "onChange" | "size" | "step" | "value"
> {
  size?: "xs" | "sm" | "md";
  value?: number | string;
  defaultValue?: number | string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  onChange?: (value: number) => void;
}

const numberInputFieldPadding = {
  xs: "px-2",
  sm: "px-2",
  md: "px-3",
} as const;

const numberInputTextSize = {
  xs: "ui-text-sm",
  sm: "ui-text-sm",
  md: "ui-text-base",
} as const;

const numberInputGroupVariants = cva("flex min-w-0 items-center gap-1", {
  variants: {
    disabled: {
      true: "opacity-50",
      false: "",
    },
  },
});

function toNumber(value: number | string | undefined) {
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default function NumberInput({
  size = "sm",
  value,
  defaultValue,
  onChange,
  className,
  disabled = false,
  min,
  max,
  step,
  required,
  readOnly,
  name,
  id,
  ...props
}: InputProps) {
  const numericStep = toNumber(step) ?? 1;
  const precision =
    numericStep > 0 ? (numericStep.toString().split(".")[1]?.length ?? 0) : undefined;

  return (
    <NumberFieldPrimitive.Root
      id={id}
      name={name}
      value={toNumber(value)}
      defaultValue={toNumber(defaultValue) ?? 0}
      min={toNumber(min)}
      max={toNumber(max)}
      step={numericStep}
      required={required}
      readOnly={readOnly}
      disabled={disabled}
      format={{
        useGrouping: false,
        maximumFractionDigits: precision,
      }}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onChange?.(nextValue);
      }}
      className={cn(numberInputGroupVariants({ disabled }), className)}
    >
      <NumberFieldPrimitive.Decrement
        render={<Button type="button" variant="ghost" size="icon-xs" className="shrink-0" />}
        aria-label="Decrease value"
      >
        <Minus size={controlIconSizes[size]} />
      </NumberFieldPrimitive.Decrement>

      <NumberFieldPrimitive.Input
        data-setting-primary-control="true"
        {...props}
        className={cn(
          controlSurfaceVariants({ variant: "default" }),
          controlSizeVariants({ size }),
          numberInputTextSize[size],
          numberInputFieldPadding[size],
          "min-w-[5ch] flex-1 bg-transparent text-center tabular-nums text-foreground outline-none placeholder:text-subtle-foreground",
        )}
      />

      <NumberFieldPrimitive.Increment
        render={<Button type="button" variant="ghost" size="icon-xs" className="shrink-0" />}
        aria-label="Increase value"
      >
        <Plus size={controlIconSizes[size]} />
      </NumberFieldPrimitive.Increment>
    </NumberFieldPrimitive.Root>
  );
}
