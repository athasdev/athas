import { cn } from "@/utils/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export default function Switch({
  checked,
  onChange,
  disabled = false,
  size = "md",
  className,
}: SwitchProps) {
  const sizeClasses = {
    sm: "w-7 h-3.5 after:h-2.5 after:w-2.5 after:top-[2px] after:left-[2px] peer-checked:after:translate-x-3.5",
    md: "w-9 h-5 after:h-4 after:w-4 after:top-[2px] after:left-[2px] peer-checked:after:translate-x-4",
  };

  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
      />
      <div
        className={cn(
          "peer rounded border bg-secondary-bg transition-colors duration-200",
          "after:absolute after:rounded after:bg-text after:shadow-sm after:transition-all after:content-['']",
          "border-border peer-checked:border-blue-500 peer-checked:bg-blue-500 peer-checked:after:bg-white",
          "peer-focus:ring-1 peer-focus:ring-blue-500/50",
          sizeClasses[size],
        )}
      />
    </label>
  );
}
