import { cva } from "class-variance-authority";
import { Minus, Plus } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";

interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "onChange"
> {
  size?: "xs" | "sm" | "md";
  onChange?: (value: number) => void;
}

const numberInputFieldVariants = cva(
  "rounded text-text focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        xs: "ui-text-sm px-2 py-1",
        sm: "ui-text-sm px-2 py-1",
        md: "ui-text-md px-3 py-1.5",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

const numberInputStepperButtonVariants = cva(
  "bg-secondary-bg text-text transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-secondary-bg",
  {
    variants: {
      segment: {
        top: "border-border border-b",
        bottom: "",
      },
    },
    defaultVariants: {
      segment: "bottom",
    },
  },
);

export default function NumberInput({
  size = "sm",
  value,
  onChange,
  className,
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
    if (value !== undefined) {
      const numValue = parseNumber(value);
      if (!Number.isNaN(numValue)) {
        setInputValue(formatValue(numValue));
        setNumericValue(numValue);
      }
    }
  }, [value, precision]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputStr = e.target.value;
    setInputValue(inputStr);

    if (inputStr === "" || inputStr === "-") {
      return;
    }

    const newValue = parseNumber(inputStr);
    if (!Number.isNaN(newValue)) {
      setNumericValue(newValue);
      onChange?.(newValue);
    }
  };

  const handleBlur = () => {
    let finalValue = numericValue;

    if (inputValue === "" || inputValue === "-" || Number.isNaN(parseNumber(inputValue))) {
      finalValue = 0;
    } else {
      finalValue = parseNumber(inputValue);
    }

    const clampedValue = Math.max(min, Math.min(max, finalValue));

    setInputValue(formatValue(clampedValue));
    setNumericValue(clampedValue);
    onChange?.(clampedValue);
  };

  const handleIncrement = () => {
    if (numericValue < max) {
      const newValue = Math.min(max, Number((numericValue + step).toFixed(Math.max(precision, 6))));
      setInputValue(formatValue(newValue));
      setNumericValue(newValue);
      onChange?.(newValue);
    }
  };

  const handleDecrement = () => {
    if (numericValue > min) {
      const newValue = Math.max(min, Number((numericValue - step).toFixed(Math.max(precision, 6))));
      setInputValue(formatValue(newValue));
      setNumericValue(newValue);
      onChange?.(newValue);
    }
  };

  return (
    <div className="flex items-center overflow-hidden rounded border border-border bg-secondary-bg">
      <input
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        className={cn(numberInputFieldVariants({ size }), className)}
        {...props}
      />
      <div className="flex h-full flex-col border-border border-l">
        <button
          type="button"
          onClick={handleIncrement}
          disabled={numericValue >= max}
          className={numberInputStepperButtonVariants({ segment: "top" })}
        >
          <Plus className="text-text-lighter" />
        </button>
        <button
          type="button"
          onClick={handleDecrement}
          disabled={numericValue <= min}
          className={numberInputStepperButtonVariants({ segment: "bottom" })}
        >
          <Minus className="text-text-lighter" />
        </button>
      </div>
    </div>
  );
}
