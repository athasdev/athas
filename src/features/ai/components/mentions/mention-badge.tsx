import { FileText } from "@phosphor-icons/react";
import Badge from "@/ui/badge";
import { cn } from "@/utils/cn";

interface MentionBadgeProps {
  fileName: string;
  className?: string;
}

export default function MentionBadge({ fileName, className }: MentionBadgeProps) {
  return (
    <Badge
      size="sm"
      className={cn(
        "gap-1 border border-accent/30 bg-accent/10 px-1.5 text-accent select-none",
        className,
      )}
    >
      <FileText className="text-accent" />
      <span className="max-w-20 truncate">{fileName}</span>
    </Badge>
  );
}
