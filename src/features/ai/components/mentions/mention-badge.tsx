import { FileText } from "lucide-react";
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
        "gap-1 border border-blue-500/30 bg-blue-500/10 px-1.5 text-blue-400 select-none",
        className,
      )}
    >
      <FileText className="text-blue-500" />
      <span className="max-w-20 truncate">{fileName}</span>
    </Badge>
  );
}
