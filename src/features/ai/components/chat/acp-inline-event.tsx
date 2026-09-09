import { CheckCircleIcon, ClockIcon, KeyIcon, WarningCircleIcon } from "@/ui/icons";
import type { ChatAcpEvent } from "@/features/ai/types/chat-ui.types";
import { ChatActivityLine } from "./chat-activity-line";

interface AcpInlineEventProps {
  event: ChatAcpEvent;
}

function getEventIcon(event: ChatAcpEvent) {
  if (event.category === "permission") return KeyIcon;
  if (event.state === "error") return WarningCircleIcon;
  if (event.state === "success") return CheckCircleIcon;
  return ClockIcon;
}

export function AcpInlineEvent({ event }: AcpInlineEventProps) {
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
    <div className="min-w-0 px-4 py-0.5">
      <ChatActivityLine icon={<Icon />} title={text} state={state} />
    </div>
  );
}
