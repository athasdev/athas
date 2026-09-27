import { WarningCircleIcon } from "@/ui/icons";
import { Marker, MarkerContent, MarkerIcon } from "@/ui/marker";
import { describeAgentStopNotice } from "../../lib/agent-stop-notice";
import type { AgentStopNotice as AgentStopNoticeKind } from "../../types/ai-chat.types";

/** Says why the agent's turn ended early: a limit it hit, or a refusal. */
export function AgentStopNotice({ notice }: { notice: AgentStopNoticeKind }) {
  const { title, description } = describeAgentStopNotice(notice);

  return (
    <Marker role="status" tone="warning" className="mt-2 items-start">
      <MarkerIcon>
        <WarningCircleIcon />
      </MarkerIcon>
      <MarkerContent className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span>{description}</span>
      </MarkerContent>
    </Marker>
  );
}
