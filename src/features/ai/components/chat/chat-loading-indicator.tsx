import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import { ThinkingOrb, type ThinkingOrbProps } from "@/ui/thinking-orb";
import { cn } from "@/utils/cn";

interface ChatLoadingIndicatorProps {
  label?: string;
  showLabel?: boolean;
  compact?: boolean;
  className?: string;
  state?: ThinkingOrbProps["state"];
}

export function ChatLoadingIndicator({
  label = "loading",
  showLabel = true,
  compact = false,
  className,
  state = "working",
}: ChatLoadingIndicatorProps) {
  return (
    <Marker
      role="status"
      aria-label={showLabel ? undefined : label}
      className={cn(compact && "w-fit", className)}
    >
      <MarkerIcon className="size-5">
        <ThinkingOrb state={state} size={20} aria-hidden="true" />
      </MarkerIcon>
      {showLabel ? <MarkerContent className="ui-text-shimmer">{label}</MarkerContent> : null}
    </Marker>
  );
}
