import type React from "react";
import { cn } from "../../utils/cn";

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Section({ title, description, children, className }: SectionProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h4 className="font-medium text-sm text-text">{title}</h4>
        {description && <p className="text-text-lighter text-xs">{description}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-text text-xs">{label}</div>
        {description && <div className="text-text-lighter text-xs">{description}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
