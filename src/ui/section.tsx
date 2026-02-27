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
    <div className={cn("rounded-2xl border border-border/70 bg-transparent px-4 py-3", className)}>
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
}

export function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4 px-1 py-2.5", className)}>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-text text-xs">{label}</div>
        {description && <div className="text-text-lighter text-xs">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
