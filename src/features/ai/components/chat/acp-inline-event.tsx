import {
  WarningCircleIcon as AlertCircle,
  CheckCircleIcon as CheckCircle2,
  ClockIcon as Clock3,
  KeyIcon as KeyRound,
  SparkleIcon as Sparkles,
  WrenchIcon as Wrench,
} from "@phosphor-icons/react";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";
import { cn } from "@/utils/cn";
import { ChatActivityLine } from "./chat-activity-line";

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
  if (event.kind === "thinking") {
    return null;
  }

  const Icon = getEventIcon(event);
  const text = event.detail ? `${event.label}: ${event.detail}` : event.label;
  const state =
    event.state === "error"
      ? "error"
      : event.state === "success"
        ? "success"
        : event.state === "running"
          ? "running"
          : "info";

  return (
    <div className="px-4 py-0.5">
      <ChatActivityLine
        icon={
          <Icon
            size={13}
            className={cn(
              event.state === "success" && "text-success/75",
              event.state === "error" && "text-error/80",
            )}
          />
        }
        title={text}
        state={state}
      />
    </div>
  );
}
