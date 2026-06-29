import { cn } from "@/utils/cn";

interface ProBadgeProps {
  className?: string;
}

export function ProBadge({ className }: ProBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-accent/15 px-1.5 py-0.5 font-semibold ui-text-sm text-accent leading-none tracking-wide",
        className,
      )}
    >
      PRO
    </span>
  );
}
