import { AgentPlan } from "@/features/ai/components/messages/agent-plan";
import { ScrollArea } from "@/ui/scroll-area";
import type { SessionPlan } from "../services/session-plan";

/** The plan the agent keeps for its current turn. */
export function SessionPlanView({ plan }: { plan: SessionPlan }) {
  return (
    <ScrollArea fill="flex" contentClassName="p-2">
      <AgentPlan entries={plan.entries} isStreaming={plan.isStreaming} />
    </ScrollArea>
  );
}
