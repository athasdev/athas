import Badge from "@/ui/badge";
import { cn } from "@/utils/cn";

interface ProBadgeProps {
  className?: string;
}

export function ProBadge({ className }: ProBadgeProps) {
  return (
    <Badge variant="accent" size="compact" className={cn("font-medium tracking-wide", className)}>
      PRO
    </Badge>
  );
}
