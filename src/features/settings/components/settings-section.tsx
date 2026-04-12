import { Info, RotateCcw } from "lucide-react";
import type React from "react";
import { Button } from "@/ui/button";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const SETTINGS_CONTROL_WIDTHS = {
  compact: "w-fit min-w-0 max-w-20",
  default: "w-fit min-w-0 max-w-32",
  wide: "w-fit min-w-0 max-w-40",
  xwide: "w-fit min-w-0 max-w-56",
  number: "w-20",
  numberCompact: "w-16",
  text: "w-48",
  textWide: "w-56",
} as const;

export default function Section({ title, description, children, className }: SectionProps) {
  return (
    <section className={cn("px-1 py-1", className)} data-settings-section={title}>
      <div className="sticky top-[-16px] z-10 mb-3 bg-primary-bg/95 px-1 py-2 backdrop-blur-sm">
        <h4 className="ui-font ui-text-md text-text">{title}</h4>
        {description && <p className="ui-font ui-text-sm text-text-lighter">{description}</p>}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: string;
  description?: string;
  info?: string;
  children: React.ReactNode;
  className?: string;
  onReset?: () => void;
  canReset?: boolean;
  resetLabel?: string;
}

export function SettingRow({
  label,
  description,
  info,
  children,
  className,
  onReset,
  canReset = !!onReset,
  resetLabel,
}: SettingRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4 px-1 py-2.5", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="ui-font ui-text-sm text-text">{label}</div>
          {info && (
            <Tooltip content={info} side="right">
              <Info className="size-3.5 cursor-help text-text-lighter transition-colors hover:text-text" />
            </Tooltip>
          )}
          {onReset && canReset && (
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              onClick={onReset}
              aria-label={resetLabel || `Reset ${label}`}
              tooltip={resetLabel || `Reset ${label}`}
            >
              <RotateCcw />
            </Button>
          )}
        </div>
        {description && <div className="ui-font ui-text-sm text-text-lighter">{description}</div>}
      </div>
      <div className="ui-font ui-text-sm shrink-0 [--app-ui-control-font-size:var(--ui-text-sm)]">
        {children}
      </div>
    </div>
  );
}
