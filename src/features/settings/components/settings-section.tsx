import { RotateCcw } from "lucide-react";
import type React from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

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
  children: React.ReactNode;
  className?: string;
  onReset?: () => void;
  canReset?: boolean;
  resetLabel?: string;
}

export function SettingRow({
  label,
  description,
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
          {onReset && (
            <Button
              type="button"
              variant="secondary"
              size="icon-xs"
              onClick={onReset}
              disabled={!canReset}
              className={cn(canReset ? undefined : "cursor-default opacity-40")}
              aria-label={resetLabel || `Reset ${label}`}
              title={resetLabel || `Reset ${label}`}
            >
              <RotateCcw />
            </Button>
          )}
        </div>
        {description && <div className="ui-font ui-text-sm text-text-lighter">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
