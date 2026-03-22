import { RotateCcw } from "lucide-react";
import type React from "react";
import { cn } from "@/utils/cn";

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Section({ title, description, children, className }: SectionProps) {
  return (
    <div className={cn("px-1 py-1", className)}>
      <div className="mb-3">
        <h4 className="font-semibold text-sm text-text">{title}</h4>
        {description && <p className="text-text-lighter text-xs">{description}</p>}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
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
          <div className="font-medium text-text text-xs">{label}</div>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={!canReset}
              className={cn(
                "inline-flex h-4.5 w-4.5 items-center justify-center rounded text-text-lighter transition-colors",
                canReset ? "hover:bg-hover hover:text-text" : "cursor-default opacity-40",
              )}
              aria-label={resetLabel || `Reset ${label}`}
              title={resetLabel || `Reset ${label}`}
            >
              <RotateCcw size={10} />
            </button>
          )}
        </div>
        {description && <div className="text-text-lighter text-xs">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
