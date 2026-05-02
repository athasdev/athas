import type React from "react";
import { Minus, Plus } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import {
  controlFieldIconSizes,
  controlFieldSizeVariants,
  controlFieldSurfaceVariants,
} from "@/ui/control-field";
import { cn } from "@/utils/cn";

interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "onChange"
> {
  size?: "xs" | "sm" | "md";
  onChange?: (value: number) => void;
}

const numberInputFieldPadding = {
  xs: "px-2",
  sm: "px-2",
  md: "px-3",
} as const;

const numberInputButtonSize = {
  xs: "icon-xs",
  sm: "icon-sm",
  md: "icon-md",
} as const;

const numberInputTextSize = {
  xs: "ui-text-sm",
  sm: "ui-text-sm",
  md: "ui-text-md",
} as const;

export default function NumberInput({
  size = "sm",
  value,
  onChange,
  className,
  disabled = false,
  onKeyDown,
  ...props
}: InputProps) {
  const parseNumber = (raw: string | number | readonly string[]) => {
    const normalized = Array.isArray(raw) ? raw[0] : raw;
    return Number.parseFloat(normalized.toString());
  };

  const step = props.step ? parseNumber(props.step) : 1;
  const precision =
    Number.isFinite(step) && step > 0 ? (step.toString().split(".")[1]?.length ?? 0) : 0;

  const formatValue = (num: number) => {
    if (Number.isNaN(num)) return "0";

    return precision > 0
      ? num.toFixed(precision).replace(/\.?0+$/, "")
      : Math.round(num).toString();
  };

  const [inputValue, setInputValue] = useState<string>(value?.toString() || "0");
  const [numericValue, setNumericValue] = useState<number>(value ? parseNumber(value) : 0);

  const min = props.min ? parseNumber(props.min) : Number.MIN_SAFE_INTEGER;
  const max = props.max ? parseNumber(props.max) : Number.MAX_SAFE_INTEGER;

  useEffect(() => {
    if (value === undefined) return;

    const nextValue = parseNumber(value);
    if (Number.isNaN(nextValue)) return;

    setInputValue(formatValue(nextValue));
    setNumericValue(nextValue);
  }, [value, precision]);

  const commitValue = (nextValue: number) => {
    const clampedValue = Math.max(min, Math.min(max, nextValue));
    setInputValue(formatValue(clampedValue));
    setNumericValue(clampedValue);
    onChange?.(clampedValue);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextInputValue = event.target.value;
    setInputValue(nextInputValue);

    if (nextInputValue === "" || nextInputValue === "-") {
      return;
    }

    const nextValue = parseNumber(nextInputValue);
    if (!Number.isNaN(nextValue)) {
      setNumericValue(nextValue);
      onChange?.(nextValue);
    }
  };

  const handleBlur = () => {
    if (inputValue === "" || inputValue === "-") {
      commitValue(0);
      return;
    }

    const parsedValue = parseNumber(inputValue);
    commitValue(Number.isNaN(parsedValue) ? numericValue : parsedValue);
  };

  const handleStep = (direction: 1 | -1) => {
    if (disabled) return;

    const nextValue = Number((numericValue + step * direction).toFixed(Math.max(precision, 6)));
    commitValue(nextValue);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      handleStep(1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      handleStep(-1);
    }
  };

  const canDecrement = !disabled && numericValue > min;
  const canIncrement = !disabled && numericValue < max;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="ghost"
        size={numberInputButtonSize[size]}
        onClick={() => handleStep(-1)}
        disabled={!canDecrement}
        aria-label="Decrease value"
        className="shrink-0"
      >
        <Minus size={controlFieldIconSizes[size]} />
      </Button>

      <input
        data-setting-primary-control="true"
        {...props}
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        type="text"
        inputMode="decimal"
        className={cn(
          controlFieldSurfaceVariants({ variant: "secondary" }),
          controlFieldSizeVariants({ size }),
          numberInputTextSize[size],
          numberInputFieldPadding[size],
          "min-w-[5ch] flex-1 bg-transparent text-center tabular-nums text-text outline-none placeholder:text-text-lighter",
        )}
      />

      <Button
        type="button"
        variant="ghost"
        size={numberInputButtonSize[size]}
        onClick={() => handleStep(1)}
        disabled={!canIncrement}
        aria-label="Increase value"
        className="shrink-0"
      >
        <Plus size={controlFieldIconSizes[size]} />
      </Button>
    </div>
  );
}
