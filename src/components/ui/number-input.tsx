import { Minus, Plus } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";

interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "onChange"> {
  size?: "xs" | "sm" | "md";
  onChange?: (value: number) => void;
}

const sizeClasses = {
  xs: "px-2 py-1 text-xs",
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export default function NumberInput({
  size = "sm",
  value,
  onChange,
  className,
  ...props
}: InputProps) {
  const [inputValue, setInputValue] = useState<string>(value?.toString() || "0");
  const [numericValue, setNumericValue] = useState<number>(value ? parseInt(value.toString()) : 0);

  const min = props.min ? parseInt(props.min.toString()) : Number.MIN_SAFE_INTEGER;
  const max = props.max ? parseInt(props.max.toString()) : Number.MAX_SAFE_INTEGER;

  useEffect(() => {
    if (value !== undefined) {
      const newValue = value.toString();
      const numValue = parseInt(newValue);
      if (!Number.isNaN(numValue)) {
        setInputValue(newValue);
        setNumericValue(numValue);
      }
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputStr = e.target.value;
    setInputValue(inputStr);

    if (inputStr === "" || inputStr === "-") {
      return;
    }

    const newValue = parseInt(inputStr);
    if (!Number.isNaN(newValue)) {
      setNumericValue(newValue);
      onChange?.(newValue);
    }
  };

  const handleBlur = () => {
    let finalValue = numericValue;

    if (inputValue === "" || inputValue === "-" || Number.isNaN(parseInt(inputValue))) {
      finalValue = 0;
    } else {
      finalValue = parseInt(inputValue);
    }

    const clampedValue = Math.max(min, Math.min(max, finalValue));

    setInputValue(clampedValue.toString());
    setNumericValue(clampedValue);
    onChange?.(clampedValue);
  };

  const handleIncrement = () => {
    if (numericValue < max) {
      const newValue = numericValue + 1;
      setInputValue(newValue.toString());
      setNumericValue(newValue);
      onChange?.(newValue);
    }
  };

  const handleDecrement = () => {
    if (numericValue > min) {
      const newValue = numericValue - 1;
      setInputValue(newValue.toString());
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
        className={cn(
          "rounded text-text focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
          sizeClasses[size],
        )}
        {...props}
      />
      <div className="flex h-full flex-col border-border border-l">
        <button
          type="button"
          onClick={handleIncrement}
          disabled={numericValue >= max}
          className={cn(
            "border-border border-b bg-secondary-bg text-text transition-colors hover:bg-hover",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-secondary-bg",
          )}
        >
          <Plus size={14} className="text-text-lighter" />
        </button>
        <button
          type="button"
          onClick={handleDecrement}
          disabled={numericValue <= min}
          className={cn(
            "bg-secondary-bg text-text transition-colors hover:bg-hover",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-secondary-bg",
          )}
        >
          <Minus size={14} className="text-text-lighter" />
        </button>
      </div>
    </div>
  );
}
