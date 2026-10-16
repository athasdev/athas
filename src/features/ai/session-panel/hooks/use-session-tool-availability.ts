import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { DockOwner } from "@/features/layout/types/dock.types";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import { getLatestSessionPlan } from "../services/session-plan";

/** A cloud session runs remotely, so its changes, terminal and browser are not on this machine. */
export function useIsLocalSession(owner: DockOwner): boolean {
  return useAIChatStore(
    (state) =>
      owner.kind === "session" &&
      !state.chats.find((chat) => chat.id === owner.id)?.sessionSettings?.cloud,
  );
}

/** Plan is offered while the session's agent keeps one. */
export function useHasSessionPlan(owner: DockOwner): boolean {
  const { messages } = useAgentSessionContext(owner.kind === "session" ? owner.id : null);
  return Boolean(messages && getLatestSessionPlan(messages));
}
