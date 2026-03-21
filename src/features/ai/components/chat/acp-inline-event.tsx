import { AlertCircle, CheckCircle2, Clock3, KeyRound, Sparkles, Wrench } from "lucide-react";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui";
import { cn } from "@/utils/cn";

interface AcpInlineEventProps {
  event: ChatAcpEvent;
}

function getEventIcon(event: ChatAcpEvent) {
  if (event.kind === "tool") return Wrench;
  if (event.kind === "permission") return KeyRound;
  if (event.kind === "thinking") return Sparkles;
  if (event.state === "error") return AlertCircle;
  if (event.state === "success") return CheckCircle2;
  return Clock3;
}

export function AcpInlineEvent({ event }: AcpInlineEventProps) {
  const Icon = getEventIcon(event);
  const text = event.detail ? `${event.label}: ${event.detail}` : event.label;

  return (
    <div className="px-4 py-1.5">
      <div className="flex items-center gap-2 text-[11px] text-text-lighter">
        <Icon
          size={12}
          className={cn(
            "shrink-0",
            event.state === "running" && "animate-spin text-text-lighter/70",
            event.state === "success" && "text-green-400/75",
            event.state === "error" && "text-red-400/80",
            (!event.state || event.state === "info") && "text-text-lighter/70",
          )}
        />
        <div className="min-w-0 truncate">
          <span className="font-medium text-text/90">{text}</span>
        </div>
      </div>
    </div>
  );
}
