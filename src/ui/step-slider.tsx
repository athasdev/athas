import { cva } from "class-variance-authority";
import { useState } from "react";

export interface StepSliderStep {
  value: string;
  label: string;
  description?: string;
}

const stepFillVariants = cva("h-1.5 w-full rounded-full", {
  variants: {
    tone: {
      0: "bg-border group-hover/step:bg-border-strong",
      1: "bg-step-tone-1",
      2: "bg-step-tone-2",
      3: "bg-step-tone-3",
      4: "bg-step-tone-4",
    },
  },
});

const autoStepVariants = cva(
  "h-5 shrink-0 rounded-sm px-1.5 ui-text-caption outline-none focus-visible:ring-2 focus-visible:ring-focus",
  {
    variants: {
      checked: {
        true: "bg-primary-soft text-primary",
        false: "text-muted-foreground hover:bg-accent hover:text-foreground",
      },
    },
  },
);

function fillTone(index: number, count: number): 1 | 2 | 3 | 4 {
  if (count <= 1) return 4;
  return (1 + Math.round((3 * index) / (count - 1))) as 1 | 2 | 3 | 4;
}

/**
 * An ordered scale picked by its steps: every step up to the chosen one fills, in a tone that
 * deepens toward the top. `autoStep` sits apart before the track for a choice that is not a point
 * on the scale, such as leaving it to the agent. Left and right arrows move along the scale.
 */
export function StepSlider({
  label,
  steps,
  value,
  onValueChange,
  autoStep,
  markedValue,
  markedLabel,
}: {
  label: string;
  steps: StepSliderStep[];
  value: string;
  onValueChange: (value: string) => void;
  autoStep?: StepSliderStep;
  /** A step to call out next to its label, such as the model's default. */
  markedValue?: string;
  markedLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const currentIndex = steps.findIndex((step) => step.value === value);
  const isAuto = Boolean(autoStep) && (autoStep?.value === value || currentIndex === -1);
  const current = isAuto ? autoStep : (steps[currentIndex] ?? steps[0]);
  const shown =
    (hovered === autoStep?.value ? autoStep : steps.find((step) => step.value === hovered)) ??
    current;

  const move = (delta: number) => {
    const from = isAuto ? (delta > 0 ? -1 : steps.length) : currentIndex;
    const next = steps[Math.min(steps.length - 1, Math.max(0, from + delta))];
    if (next && next.value !== value) onValueChange(next.value);
  };

  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-col gap-1 px-2 pt-1.5 pb-1"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        move(event.key === "ArrowRight" ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-2 ui-text-sm">
        <span className="text-foreground">{label}</span>
        <span className="truncate text-muted-foreground">
          {shown?.label}
          {shown && markedLabel && shown.value === markedValue ? ` · ${markedLabel}` : null}
        </span>
      </div>
      <div role="radiogroup" aria-label={`${label} level`} className="flex items-center gap-2">
        {autoStep ? (
          <button
            type="button"
            role="radio"
            aria-checked={isAuto}
            title={autoStep.description}
            onPointerEnter={() => setHovered(autoStep.value)}
            onPointerLeave={() => setHovered(null)}
            onClick={() => onValueChange(autoStep.value)}
            className={autoStepVariants({ checked: isAuto })}
          >
            {autoStep.label}
          </button>
        ) : null}
        <div
          className="flex h-5 flex-1 items-center gap-0.5"
          onPointerLeave={() => setHovered(null)}
        >
          {steps.map((step, index) => (
            <button
              key={step.value}
              type="button"
              role="radio"
              aria-checked={!isAuto && index === currentIndex}
              aria-label={step.label}
              title={step.description}
              onPointerEnter={() => setHovered(step.value)}
              onClick={() => onValueChange(step.value)}
              className="group/step flex h-full min-w-0 flex-1 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span
                className={stepFillVariants({
                  tone: !isAuto && index <= currentIndex ? fillTone(index, steps.length) : 0,
                })}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
