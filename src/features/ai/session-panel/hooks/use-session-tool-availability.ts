import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { DockOwner } from "@/features/layout/types/dock.types";
import { useAgentSessionContext } from "@/features/ai/hooks/use-agent-session-context";
import { getLatestSessionPlan } from "../services/session-plan";
import { isAgentWindow } from "@/features/ai/detached/services/agent-window-service";

/** A cloud session runs remotely, so its changes, terminal and browser are not on this machine. */
export function useIsLocalSession(owner: DockOwner): boolean {
  return useAIChatStore(
    (state) =>
      owner.kind === "session" &&
      !state.chats.find((chat) => chat.id === owner.id)?.sessionSettings?.cloud,
  );
}

/** A local session's terminal and browser, which only the main window hosts. */
export function useIsLocalSessionInMainWindow(owner: DockOwner): boolean {
  return useIsLocalSession(owner) && !isAgentWindow();
}

/** Changes is offered once the session's agent has changed a file. */
export function useSessionHasChanges(chatId: string): boolean {
  const { context } = useAgentSessionContext(chatId);
  return context.changes.length > 0;
}

/** Plan is offered while the session's agent keeps one. */
export function useHasSessionPlan(owner: DockOwner): boolean {
  const { messages } = useAgentSessionContext(owner.kind === "session" ? owner.id : null);
  return Boolean(messages && getLatestSessionPlan(messages));
}
