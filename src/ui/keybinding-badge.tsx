import { cn } from "@/utils/cn";

interface KeybindingBadgeProps {
  keys: string[];
  className?: string;
  separator?: string;
}

export default function KeybindingBadge({
  keys,
  className,
  separator = "+",
}: KeybindingBadgeProps) {
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {keys.map((key, index) => (
        <span key={index} className="flex items-center gap-0.5">
          <kbd className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded border border-border bg-secondary-bg px-0.5 font-mono text-[10px] text-text-lighter">
            {key}
          </kbd>
          {index < keys.length - 1 && (
            <span className="text-[10px] text-text-lighter">{separator}</span>
          )}
        </span>
      ))}
    </div>
  );
}
