import { ArrowCounterClockwise as RotateCcw } from "@phosphor-icons/react";
import React from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const SETTINGS_CONTROL_WIDTHS = {
  compact: "w-28",
  default: "w-36",
  wide: "w-44",
  xwide: "w-56",
  number: "w-28",
  numberCompact: "w-24",
  text: "w-48",
  textWide: "w-56",
} as const;

export default function Section({ title, description, children, className }: SectionProps) {
  return (
    <section
      className={cn("px-1 py-0.5 first:[&>.settings-section-header]:hidden", className)}
      data-settings-section={title}
    >
      <div className="settings-section-header mb-2 px-1 py-1.5">
        <h4 className="ui-font ui-text-md text-text">{title}</h4>
        {description && <p className="ui-font ui-text-sm text-text-lighter">{description}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: string;
  labelAccessory?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  className?: string;
  onReset?: () => void;
  canReset?: boolean;
  resetLabel?: string;
}

export function SettingRow({
  label,
  labelAccessory,
  description,
  children,
  className,
  onReset,
  canReset = !!onReset,
  resetLabel,
}: SettingRowProps) {
  const controlRef = React.useRef<HTMLDivElement>(null);
  const rowId = React.useId();
  const labelId = `${rowId}-label`;
  const descriptionId = `${rowId}-description`;

  const interactiveSelector =
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role='button'], [role='switch'], [tabindex]:not([tabindex='-1'])";
  const passthroughSelector =
    "button, input, select, textarea, a, label, [role='button'], [role='switch'], [data-slot='button'], [data-setting-interactive-root='true']";

  const getPrimaryInteractive = React.useCallback(() => {
    const controlRoot = controlRef.current;
    if (!controlRoot) return null;

    const primaryInteractive =
      controlRoot.querySelector<HTMLElement>(
        "[data-setting-primary-control='true'], [data-setting-interactive-root='true']",
      ) ?? controlRoot.querySelector<HTMLElement>(interactiveSelector);

    if (!primaryInteractive) return null;

    return primaryInteractive.matches(interactiveSelector)
      ? primaryInteractive
      : primaryInteractive.querySelector<HTMLElement>(interactiveSelector);
  }, [interactiveSelector]);

  React.useLayoutEffect(() => {
    const control = getPrimaryInteractive();
    if (!control) return;

    if (!control.getAttribute("aria-labelledby") && !control.getAttribute("aria-label")) {
      control.setAttribute("aria-labelledby", labelId);
    }

    if (description && !control.getAttribute("aria-describedby")) {
      control.setAttribute("aria-describedby", descriptionId);
    }
  }, [description, descriptionId, getPrimaryInteractive, labelId]);

  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;

    if (target.closest(passthroughSelector)) {
      return;
    }

    const segmentedControl = controlRef.current?.querySelector<HTMLElement>(
      "[data-setting-segmented-control='true']",
    );
    if (segmentedControl) {
      const segmentedItems = Array.from(
        segmentedControl.querySelectorAll<HTMLElement>("[role='button']"),
      ).filter((item) => !item.hasAttribute("disabled"));
      const activeIndex = segmentedItems.findIndex(
        (item) => item.getAttribute("data-setting-segmented-active") === "true",
      );

      if (segmentedItems.length > 0) {
        const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % segmentedItems.length : 0;
        const nextItem = segmentedItems[nextIndex];
        nextItem?.focus();
        nextItem?.click();
        return;
      }
    }

    const firstInteractive = getPrimaryInteractive();
    if (!firstInteractive) return;

    if (firstInteractive.getAttribute("role") === "combobox") {
      firstInteractive.focus();
      firstInteractive.click();
      return;
    }

    if (firstInteractive.getAttribute("aria-expanded") != null) {
      firstInteractive.focus();
      firstInteractive.click();
      return;
    }

    if (
      firstInteractive instanceof HTMLInputElement &&
      firstInteractive.type !== "checkbox" &&
      firstInteractive.type !== "radio"
    ) {
      firstInteractive.focus();
      firstInteractive.select?.();
      return;
    }

    firstInteractive.focus();
    firstInteractive.click();
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg px-1 py-2 select-none transition-colors hover:bg-hover/40 focus-within:bg-hover/40",
        className,
      )}
      onClick={handleRowClick}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div id={labelId} className="ui-font ui-text-sm cursor-default text-text">
            {label}
          </div>
          {labelAccessory}
          {onReset ? (
            <span className="flex size-5 items-center justify-center">
              <Button
                type="button"
                variant="secondary"
                size="icon-xs"
                onClick={onReset}
                disabled={!canReset}
                aria-label={resetLabel || `Reset ${label}`}
                tooltip={canReset ? resetLabel || `Reset ${label}` : undefined}
                className={cn(!canReset && "pointer-events-none invisible")}
              >
                <RotateCcw />
              </Button>
            </span>
          ) : null}
        </div>
        {description && (
          <div id={descriptionId} className="ui-font ui-text-sm cursor-default text-text-lighter">
            {description}
          </div>
        )}
      </div>
      <div
        ref={controlRef}
        className="ui-font ui-text-sm shrink-0 select-auto [--app-ui-control-font-size:var(--ui-text-sm)]"
      >
        {children}
      </div>
    </div>
  );
}
