import type { ReactNode } from "react";
import { Tab, TabsList } from "@/ui/tabs";

export interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface SegmentedControlProps {
  value: string;
  options: SegmentedControlOption[];
  onChange: (value: string) => void;
  size?: "xs" | "sm" | "md";
  className?: string;
  wrap?: boolean;
}

export function SegmentedControl({
  value,
  options,
  onChange,
  size = "xs",
  className,
  wrap = true,
}: SegmentedControlProps) {
  return (
    <TabsList
      variant="segmented"
      data-setting-segmented-control="true"
      className={
        className ??
        (wrap
          ? "inline-flex h-auto max-w-full flex-wrap items-stretch gap-1 overflow-visible self-start rounded-xl border border-border/60 bg-secondary-bg/40 p-1"
          : "inline-flex w-fit max-w-full self-start")
      }
    >
      {options.map((option) => (
        <Tab
          key={option.value}
          data-setting-segmented-active={value === option.value ? "true" : undefined}
          isActive={value === option.value}
          variant="segmented"
          size={size}
          className="h-auto w-auto shrink-0 rounded-lg border-0 px-2.5 py-1.5"
          role="button"
          tabIndex={0}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onChange(option.value);
            }
          }}
        >
          {option.icon}
          <span>{option.label}</span>
        </Tab>
      ))}
    </TabsList>
  );
}
