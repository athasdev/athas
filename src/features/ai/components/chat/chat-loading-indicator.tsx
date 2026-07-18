import { Spinner } from "@/ui/spinner";

interface ChatLoadingIndicatorProps {
  label?: string;
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
}

export function ChatLoadingIndicator({
  label = "loading",
  showLabel = false,
  compact = false,
  className,
}: ChatLoadingIndicatorProps) {
  return (
    <Spinner label={label} showLabel={showLabel} compact={compact} className={className} />
  );
}
