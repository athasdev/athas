import { cva } from "class-variance-authority";
import { cn } from "@/utils/cn";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const switchTrackVariants = cva(
  [
    "peer rounded border bg-secondary-bg transition-colors duration-200",
    "after:absolute after:rounded after:bg-text after:shadow-sm after:transition-all after:content-['']",
    "border-border peer-checked:border-accent peer-checked:bg-accent peer-checked:after:bg-primary-bg",
    "peer-focus:ring-1 peer-focus:ring-border-strong/35",
  ],
  {
    variants: {
      size: {
        sm: "h-3.5 w-7 after:top-[2px] after:left-[2px] after:h-2.5 after:w-2.5 peer-checked:after:translate-x-3.5",
        md: "h-5 w-9 after:top-[2px] after:left-[2px] after:h-4 after:w-4 peer-checked:after:translate-x-4",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export default function Switch({
  checked,
  onChange,
  disabled = false,
  size = "md",
  className,
}: SwitchProps) {
  return (
    <label
      data-setting-interactive-root="true"
      data-setting-primary-control="true"
      className={cn(
        "relative inline-flex cursor-pointer items-center",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="peer sr-only"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
      />
      <div className={switchTrackVariants({ size })} />
    </label>
  );
}
