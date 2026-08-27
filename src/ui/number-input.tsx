import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { cva } from "class-variance-authority";
import type React from "react";
import { MinusIcon as Minus, PlusIcon as Plus } from "@/ui/icons";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "defaultValue" | "max" | "min" | "onChange" | "size" | "step" | "value"
> {
  value?: number | string;
  defaultValue?: number | string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  onChange?: (value: number) => void;
}

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
        render={<Button type="button" variant="ghost" iconOnly className="shrink-0" />}
        aria-label="Decrease value"
      >
        <Minus size={12} />
      </NumberFieldPrimitive.Decrement>

      <NumberFieldPrimitive.Input
        data-setting-primary-control="true"
        {...props}
        className="h-7 min-w-[5ch] flex-1 rounded-chrome border border-border bg-surface px-2 text-center font-sans ui-text-sm tabular-nums text-foreground outline-none transition-[border-color,box-shadow,background-color,color] duration-fast ease-smooth placeholder:text-subtle-foreground focus:border-border-strong focus:bg-surface focus:ring-1 focus:ring-border-strong/35 disabled:cursor-not-allowed disabled:opacity-50"
      />

      <NumberFieldPrimitive.Increment
        render={<Button type="button" variant="ghost" iconOnly className="shrink-0" />}
        aria-label="Increase value"
      >
        <Plus size={12} />
      </NumberFieldPrimitive.Increment>
    </NumberFieldPrimitive.Root>
  );
}
