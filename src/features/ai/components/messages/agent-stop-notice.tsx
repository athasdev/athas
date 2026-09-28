import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { ICON_CONCEPTS } from "@/ui/icon-concepts";
import { describeAgentStopNotice } from "../../lib/agent-stop-notice";
import type { AgentStopNotice as AgentStopNoticeKind } from "../../types/ai-chat.types";

const WarningIcon = ICON_CONCEPTS["status.warning"];

/** Says why the agent's turn ended early: a limit it hit, or a refusal. */
export function AgentStopNotice({ notice }: { notice: AgentStopNoticeKind }) {
  const { title, description } = describeAgentStopNotice(notice);

  return (
    <Alert role="status" tone="warning" data-ai-element="stop-notice">
      <WarningIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
