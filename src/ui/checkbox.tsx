import { Check } from "lucide-react";
import { cn } from "@/utils/cn";

interface CheckboxProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export default function Checkbox({
  id,
  checked,
  onChange,
  disabled = false,
  className,
  ariaLabel,
}: CheckboxProps) {
  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex size-4 items-center justify-center rounded-[5px] border border-border bg-secondary-bg text-transparent transition-colors",
          "peer-focus:ring-1 peer-focus:ring-accent/50",
          "peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white",
        )}
      >
        <Check size={11} strokeWidth={3} />
      </span>
    </label>
  );
}
