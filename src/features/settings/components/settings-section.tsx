import { cva, type VariantProps } from "class-variance-authority";
import { ArrowCounterClockwiseIcon, CheckIcon, WarningIcon } from "@/ui/icons";
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
import { GroupedSection, type GroupedSectionProps } from "@/ui/grouped-section";
import { cn } from "@/utils/cn";
import { getSettingSearchTargetKey } from "../lib/settings-search";

type SectionProps = Omit<GroupedSectionProps, "title"> & {
  /** Also the search target: `search-index.ts` points at sections by this title. */
  title: string;
};

interface SettingsViewProps extends ComponentProps<"div"> {
  layout?: "stack" | "fill";
}

export function SettingsView({ layout = "stack", className, ...props }: SettingsViewProps) {
  return (
    <div
      data-slot="settings-view"
      className={cn(
        "min-w-0",
        layout === "stack" ? "flex flex-col gap-6" : "flex h-full min-h-0 flex-col",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A titled group of settings: a small muted header, then its rows in one grouped card. Rows
 * never draw their own borders; the card owns the edge and the hairlines between rows.
 */
export default function Section({ title, className, ...props }: SectionProps) {
  return (
    <GroupedSection
      title={title}
      className={cn("scroll-mt-4", className)}
      data-settings-section={title}
      data-settings-section-key={getSettingSearchTargetKey(title)}
      {...props}
    />
  );
}

/** Free content inside a group, such as a progress bar or an alert, on the row grid. */
export function SettingBlock({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="setting-block" className={cn("px-3 py-2.5", className)} {...props} />;
}

const settingRowVariants = cva(
  "flex min-h-10 w-full min-w-0 max-w-full items-center justify-between gap-4 py-2 pr-3 select-none transition-colors duration-fast focus:outline-none data-[settings-search-active=true]:bg-primary-soft max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2 @max-[640px]/settings:flex-col @max-[640px]/settings:items-stretch @max-[640px]/settings:gap-2",
  {
    variants: {
      /** `nested` indents a row that only applies when the row above it is on. */
      level: {
        root: "pl-3",
        nested: "pl-8 before:left-8!",
      },
    },
    defaultVariants: { level: "root" },
  },
);

const settingControlVariants = cva(
  "font-sans ui-text-sm min-w-0 max-w-full shrink-0 select-auto max-[640px]:w-full max-[640px]:shrink max-[640px]:[&>div]:flex-wrap max-[640px]:[&>input]:w-full max-[640px]:[&>textarea]:w-full @max-[640px]/settings:w-full @max-[640px]/settings:shrink @max-[640px]/settings:[&>div]:flex-wrap @max-[640px]/settings:[&>input]:w-full @max-[640px]/settings:[&>textarea]:w-full",
  {
    variants: {
      /**
       * - `auto` — the control's own width, such as a switch, select, or button
       * - `field` — one shared width for text fields, so fields line up down a page
       */
      control: {
        auto: "",
        field: "flex w-64 items-center justify-end gap-2",
      },
    },
    defaultVariants: { control: "auto" },
  },
);

const settingStatusVariants = cva(
  "inline-flex min-w-0 items-center gap-1.5 [&_svg]:size-[1em] [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        success: "text-success",
        warning: "text-warning",
        danger: "text-destructive",
        neutral: "text-subtle-foreground",
      },
    },
    defaultVariants: { tone: "success" },
  },
);

/** A short state line for a row, such as a configured key, with a matching mark. */
export function SettingStatus({
  tone,
  children,
}: VariantProps<typeof settingStatusVariants> & { children: ReactNode }) {
  const Icon = tone === "danger" || tone === "warning" ? WarningIcon : CheckIcon;
  return (
    <span className={settingStatusVariants({ tone })}>
      {tone === "neutral" ? null : <Icon />}
      <span className="truncate">{children}</span>
    </span>
  );
}

interface SettingRowProps
  extends VariantProps<typeof settingRowVariants>, VariantProps<typeof settingControlVariants> {
  label: string;
  /** Replaces the visible label text. `label` still names the row for search and a11y. */
  labelContent?: ReactNode;
  /** A small mark before the label, such as a provider logo. */
  icon?: ReactNode;
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
  labelContent,
  icon,
  labelAccessory,
  description,
  children,
  className,
  onReset,
  canReset = !!onReset,
  resetLabel,
  activateOnClick = true,
  level,
  control,
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
      className={cn(settingRowVariants({ level }), className)}
      onClick={activateOnClick ? handleRowClick : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {icon ? (
            <span className="flex shrink-0 items-center [&_svg]:size-[1em]">{icon}</span>
          ) : null}
          <div
            id={labelId}
            className="font-sans ui-text-sm min-w-0 cursor-default wrap-break-word text-foreground"
          >
            {labelContent ?? label}
          </div>
          {labelAccessory}
          {onReset ? (
            <span
              className={cn("flex size-5 items-center justify-center", !canReset && "invisible")}
            >
              <Button
                type="button"
                variant="ghost"
                onClick={onReset}
                disabled={!canReset}
                aria-label={resetLabel || `Reset ${label}`}
                tooltip={canReset ? resetLabel || `Reset ${label}` : undefined}
                iconOnly
              >
                <ArrowCounterClockwiseIcon />
              </Button>
            </span>
          ) : null}
        </div>
        {description && (
          <div
            id={descriptionId}
            className="font-sans ui-text-sm mt-0.5 cursor-default leading-snug text-subtle-foreground"
          >
            {description}
          </div>
        )}
      </div>
      <div ref={controlRef} className={settingControlVariants({ control })}>
        {children}
      </div>
    </div>
  );
}
