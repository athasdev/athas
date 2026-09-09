import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "@/utils/cn";

/** Thumb diameter. The track keeps this much room at both ends. */
const THUMB = "1.25rem";

interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Draw a stop dot for every step on the track. */
  ticks?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/** Distance from the track's left edge to the centre of the thumb at `ratio`. */
function stopOffset(ratio: number) {
  return `calc(${THUMB} / 2 + (100% - ${THUMB}) * ${ratio})`;
}

/**
 * Discrete horizontal slider on a pill track.
 *
 * The thumb is inset so it never overhangs the pill, so the fill and the stop
 * dots are positioned from the same `stopOffset` geometry rather than from the
 * raw 0-100% track. Both animate to the next stop on click, keyboard and
 * programmatic changes, and follow the pointer untransitioned while dragging.
 */
export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  ticks = false,
  disabled,
  className,
  ...props
}: SliderProps) {
  const stopCount = Math.floor((max - min) / step) + 1;
  const ratio = max === min ? 0 : (value - min) / (max - min);

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      onValueChange={(nextValue) => {
        onValueChange(Array.isArray(nextValue) ? (nextValue[0] ?? min) : nextValue);
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn("group/slider w-full", className)}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-6 w-full touch-none items-center select-none data-disabled:opacity-50">
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-accent" />

        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-normal ease-smooth group-data-[dragging]/slider:transition-none"
          style={{ width: stopOffset(ratio) }}
        />

        {ticks && stopCount > 1 && stopCount <= 12
          ? Array.from({ length: stopCount }, (_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 size-1 rounded-full bg-foreground/25"
                style={{ left: stopOffset(index / (stopCount - 1)) }}
              />
            ))
          : null}

        {/* Inset so the thumb's own 0-100% travel matches the stop geometry. */}
        <SliderPrimitive.Track
          className="relative h-6 flex-1"
          style={{ marginInline: `calc(${THUMB} / 2)` }}
        >
          <SliderPrimitive.Thumb
            className={cn(
              "size-5 rounded-full bg-background shadow-(--shadow-card) ring-1 ring-border/50 outline-none",
              "transition-[inset-inline-start,scale,box-shadow] duration-normal ease-smooth",
              // While dragging, follow the pointer with no positional easing.
              "group-data-[dragging]/slider:transition-[scale,box-shadow]",
              "hover:scale-105 group-data-[dragging]/slider:scale-110",
              "focus-visible:ring-2 focus-visible:ring-primary/40",
            )}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export default Slider;
