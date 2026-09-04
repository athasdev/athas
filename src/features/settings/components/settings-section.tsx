import { ArrowCounterClockwiseIcon as RotateCcw } from "@/ui/icons";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { cn } from "@/utils/cn";
import { getSettingSearchTargetKey } from "../lib/settings-search";

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

interface SettingsViewProps extends ComponentProps<"div"> {
  layout?: "stack" | "fill";
}

export function SettingsView({ layout = "stack", className, ...props }: SettingsViewProps) {
  return (
    <div
      data-slot="settings-view"
      className={cn(
        "min-w-0",
        layout === "stack" ? "space-y-6" : "flex h-full min-h-0 flex-col",
        className,
      )}
      {...props}
    />
  );
}

export default function Section({ title, description, children, className }: SectionProps) {
  const sectionKey = getSettingSearchTargetKey(title);

  return (
    <section
      className={cn(
        "scroll-mt-6 rounded-lg transition-[background-color,box-shadow] data-[settings-search-section-active=true]:bg-primary/5 data-[settings-search-section-active=true]:ring-1 data-[settings-search-section-active=true]:ring-primary/25",
        className,
      )}
      data-settings-section={title}
      data-settings-section-key={sectionKey}
    >
      <div className="mb-2 px-1">
        <h2 className="font-medium text-foreground ui-text-base">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-subtle-foreground ui-text-sm">{description}</p>
        ) : null}
      </div>
      <Card className="gap-0 divide-y divide-border/60 py-0">{children}</Card>
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

    const toggleGroup = controlRef.current?.querySelector<HTMLElement>(
      "[data-slot='toggle-group']",
    );
    if (toggleGroup) {
      const toggleItems = Array.from(
        toggleGroup.querySelectorAll<HTMLElement>("[data-slot='toggle-group-item']"),
      ).filter((item) => !item.hasAttribute("disabled"));
      const activeIndex = toggleItems.findIndex((item) => item.hasAttribute("data-pressed"));

      if (toggleItems.length > 0) {
        const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % toggleItems.length : 0;
        const nextItem = toggleItems[nextIndex];
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
        "flex w-full min-w-0 max-w-full items-center justify-between gap-3 px-4 py-3 select-none transition-[background-color,box-shadow] hover:bg-accent/40 focus-within:bg-accent/40 focus:outline-none data-[settings-search-active=true]:bg-primary/15 data-[settings-search-active=true]:ring-1 data-[settings-search-active=true]:ring-primary/50 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2 @max-[640px]/settings:flex-col @max-[640px]/settings:items-stretch @max-[640px]/settings:gap-2",
        className,
      )}
      onClick={activateOnClick ? handleRowClick : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div
            id={labelId}
            className="font-sans ui-text-base min-w-0 cursor-default wrap-break-word text-foreground"
          >
            {label}
          </div>
          {labelAccessory}
          {onReset ? (
            <span className="flex size-5 items-center justify-center">
              <Button
                shape="pill"
                type="button"
                variant="ghost"
                onClick={onReset}
                disabled={!canReset}
                aria-label={resetLabel || `Reset ${label}`}
                tooltip={canReset ? resetLabel || `Reset ${label}` : undefined}
                className={cn(!canReset && "pointer-events-none invisible")}
                iconOnly
              >
                <RotateCcw />
              </Button>
            </span>
          ) : null}
        </div>
        {description && (
          <div
            id={descriptionId}
            className="font-sans ui-text-sm cursor-default leading-snug text-subtle-foreground"
          >
            {description}
          </div>
        )}
      </div>
      <div
        ref={controlRef}
        className="font-sans ui-text-sm min-w-0 max-w-full shrink-0 select-auto max-[640px]:w-full max-[640px]:shrink max-[640px]:[&>div]:flex-wrap max-[640px]:[&>input]:w-full max-[640px]:[&>textarea]:w-full @max-[640px]/settings:w-full @max-[640px]/settings:shrink @max-[640px]/settings:[&>div]:flex-wrap @max-[640px]/settings:[&>input]:w-full @max-[640px]/settings:[&>textarea]:w-full"
      >
        {children}
      </div>
    </div>
  );
}
