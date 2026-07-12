import { ArrowCounterClockwiseIcon as RotateCcw } from "@/ui/icons";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { getSettingSearchTargetKey } from "../lib/settings-search";

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export const SETTINGS_CONTROL_WIDTHS = {
  compact: "w-28 max-w-full",
  default: "w-36 max-w-full",
  wide: "w-44 max-w-full",
  xwide: "w-56 max-w-full",
  number: "w-28 max-w-full",
  numberCompact: "w-24 max-w-full",
  text: "w-48 max-w-full",
  textWide: "w-56 max-w-full",
} as const;

export default function Section({ title, description, children, className }: SectionProps) {
  return (
    <section
      className={cn("px-1 py-0.5 first:[&>.settings-section-header]:hidden", className)}
      data-settings-section={title}
      data-settings-section-key={getSettingSearchTargetKey(title)}
    >
      <div className="settings-section-header mb-2 px-1 py-1.5">
        <h4 className="font-sans ui-text-base text-text">{title}</h4>
        {description && <p className="font-sans ui-text-base text-text-lighter">{description}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: string;
  labelAccessory?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  onReset?: () => void;
  canReset?: boolean;
  resetLabel?: string;
  activateOnClick?: boolean;
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
  activateOnClick = true,
}: SettingRowProps) {
  const controlRef = useRef<HTMLDivElement>(null);
  const rowId = useId();
  const labelId = `${rowId}-label`;
  const descriptionId = `${rowId}-description`;

  const interactiveSelector =
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role='button'], [role='switch'], [tabindex]:not([tabindex='-1'])";
  const passthroughSelector =
    "button, input, select, textarea, a, label, [role='button'], [role='switch'], [data-slot='button'], [data-setting-interactive-root='true']";

  const getPrimaryInteractive = useCallback(() => {
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

  useLayoutEffect(() => {
    const control = getPrimaryInteractive();
    if (!control) return;

    if (!control.getAttribute("aria-labelledby") && !control.getAttribute("aria-label")) {
      control.setAttribute("aria-labelledby", labelId);
    }

    if (description && !control.getAttribute("aria-describedby")) {
      control.setAttribute("aria-describedby", descriptionId);
    }
  }, [description, descriptionId, getPrimaryInteractive, labelId]);

  const handleRowClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;

    if (target.closest(passthroughSelector)) {
      return;
    }

    const segmentedControl = controlRef.current?.querySelector<HTMLElement>(
      "[data-slot='segmented-control']",
    );
    if (segmentedControl) {
      const segmentedItems = Array.from(
        segmentedControl.querySelectorAll<HTMLElement>("[role='button']"),
      ).filter((item) => !item.hasAttribute("disabled"));
      const activeIndex = segmentedItems.findIndex(
        (item) => item.getAttribute("data-active") === "true",
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
      data-setting-row-key={getSettingSearchTargetKey(label)}
      data-setting-row-label={label}
      tabIndex={-1}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg px-1 py-2 select-none transition-colors hover:bg-hover/40 focus-within:bg-hover/40 focus:outline-none data-[settings-search-active=true]:bg-accent/10 data-[settings-search-active=true]:ring-1 data-[settings-search-active=true]:ring-accent/35 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2",
        className,
      )}
      onClick={activateOnClick ? handleRowClick : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div id={labelId} className="font-sans ui-text-base cursor-default text-text">
            {label}
          </div>
          {labelAccessory}
          {onReset ? (
            <span className="flex size-5 items-center justify-center">
              <Button
                type="button"
                variant="ghost"
                onClick={onReset}
                disabled={!canReset}
                aria-label={resetLabel || `Reset ${label}`}
                tooltip={canReset ? resetLabel || `Reset ${label}` : undefined}
                className={cn(!canReset && "pointer-events-none invisible")}
                size="icon-xs"
              >
                <RotateCcw />
              </Button>
            </span>
          ) : null}
        </div>
        {description && (
          <div
            id={descriptionId}
            className="font-sans ui-text-base cursor-default text-text-lighter"
          >
            {description}
          </div>
        )}
      </div>
      <div
        ref={controlRef}
        className="font-sans ui-text-base shrink-0 select-auto max-[640px]:w-full max-[640px]:shrink max-[640px]:[&>input]:w-full max-[640px]:[&>textarea]:w-full"
      >
        {children}
      </div>
    </div>
  );
}
