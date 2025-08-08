import { FileText } from "lucide-react";
import { cn } from "../../utils/cn";

interface MentionBadgeProps {
  fileName: string;
  className?: string;
}

export default function MentionBadge({ fileName, className }: MentionBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-blue-400 text-xs",
        "select-none font-mono",
        className,
      )}
    >
      <FileText size={10} className="text-blue-500" />
      <span className="max-w-20 truncate">{fileName}</span>
    </span>
  );
}
