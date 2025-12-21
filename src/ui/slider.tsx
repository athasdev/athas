import { cn } from "@/utils/cn";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  showValue?: boolean;
  valueFormatter?: (value: number) => string;
}

const Slider = ({
  value,
  min,
  max,
  step = 0.1,
  onChange,
  disabled = false,
  className,
  showValue = true,
  valueFormatter = (v) => v.toString(),
}: SliderProps) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className={cn(
            "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border",
            "focus:outline-none",
            "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5",
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-sm",
            "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110",
            "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5",
            "[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent",
            disabled && "cursor-not-allowed opacity-50",
          )}
          style={{
            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percentage}%, var(--border) ${percentage}%, var(--border) 100%)`,
          }}
        />
      </div>
      {showValue && (
        <span className="min-w-[3rem] text-right text-text-light text-xs tabular-nums">
          {valueFormatter(value)}
        </span>
      )}
    </div>
  );
};

export default Slider;
