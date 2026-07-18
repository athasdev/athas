import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";

interface ChatLoadingIndicatorProps {
  label?: string;
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
}

export function ChatLoadingIndicator({
  label = "loading",
  showLabel = true,
  compact = false,
  className,
}: ChatLoadingIndicatorProps) {
  return (
    <Marker
      role="status"
      aria-label={showLabel ? undefined : label}
      className={cn(compact && "w-fit", className)}
    >
      <MarkerIcon className="text-accent">
        <Spinner />
      </MarkerIcon>
      {showLabel ? <MarkerContent className="ui-text-shimmer">{label}</MarkerContent> : null}
    </Marker>
  );
}
