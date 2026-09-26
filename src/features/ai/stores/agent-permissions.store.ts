import { create } from "zustand";
import {
  isIntelligencePermissionPending,
  respondToIntelligencePermission,
} from "@/features/ai/intelligence/services/intelligence-agent-permissions";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import type { PendingAgentPermission } from "@/features/ai/types/agent-permission.types";
import { createSelectors } from "@/utils/zustand-selectors";

interface AgentPermissionsState {
  permissions: PendingAgentPermission[];
  actions: {
    add: (permission: PendingAgentPermission) => void;
    /** The agent stopped waiting (answered elsewhere, cancelled, or timed out). */
    remove: (requestId: string) => void;
    /** Answers a prompt and drops it, whether or not the agent accepted the answer. */
    respond: (requestId: string, approved: boolean, optionId?: string) => Promise<void>;
    /** Refuses every prompt of a chat nobody will answer (the chat was deleted). */
    cancelChat: (chatId: string) => void;
    /**
     * Drops a chat's prompts after its turn was stopped. ACP and Athas's own agent close theirs
     * when the turn is cancelled; Codex prompts are refused here because Codex does not.
     */
    dropStoppedTurn: (chatId: string) => Promise<void>;
    /** Drops a chat's prompts from Athas's own agent that its finished turn no longer waits on. */
    dropSettled: (chatId: string) => void;
  };
}

function answer(permission: PendingAgentPermission, approved: boolean, optionId?: string) {
  switch (permission.responder) {
    case "intelligence":
      respondToIntelligencePermission(permission.requestId, approved);
      return Promise.resolve();
    case "codex":
      return CodexIntegrationService.respond(permission.requestId, approved);
    case "acp":
      return AcpStreamHandler.respondToPermission(permission.requestId, approved, false, optionId);
  }
}

function cancel(permission: PendingAgentPermission) {
  if (permission.responder === "acp") {
    return AcpStreamHandler.respondToPermission(permission.requestId, false, true);
  }
  return answer(permission, false);
}

/**
 * Permission prompts waiting on the user, by chat. They live outside the chat view: a chat whose
 * tab is in the background keeps its prompts, and the tab shows that it is waiting, until the
 * user comes back to answer them or the agent stops waiting.
 */
const useAgentPermissionsStoreBase = create<AgentPermissionsState>()((set, get) => {
  const take = (predicate: (permission: PendingAgentPermission) => boolean) => {
    const taken = get().permissions.filter(predicate);
    if (taken.length > 0) {
      set((state) => ({ permissions: state.permissions.filter((item) => !predicate(item)) }));
    }
    return taken;
  };

  return {
    permissions: [],
    actions: {
      add: (permission) =>
        set((state) =>
          state.permissions.some((item) => item.requestId === permission.requestId)
            ? state
            : { permissions: [...state.permissions, permission] },
        ),
      remove: (requestId) => {
        take((item) => item.requestId === requestId);
      },
      respond: async (requestId, approved, optionId) => {
        const [permission] = take((item) => item.requestId === requestId);
        if (permission) await answer(permission, approved, optionId);
      },
      cancelChat: (chatId) => {
        for (const permission of take((item) => item.chatId === chatId)) {
          void cancel(permission).catch(() => undefined);
        }
      },
      dropStoppedTurn: async (chatId) => {
        const codex = take((item) => item.chatId === chatId).filter(
          (item) => item.responder === "codex",
        );
        await Promise.all(codex.map((item) => answer(item, false)));
      },
      dropSettled: (chatId) => {
        take(
          (item) =>
            item.chatId === chatId &&
            item.responder === "intelligence" &&
            !isIntelligencePermissionPending(item.requestId),
        );
      },
    },
  };
});

export const useAgentPermissionsStore = createSelectors(useAgentPermissionsStoreBase);

/** A chat's prompts, oldest first. */
export function selectChatPermissions(
  permissions: PendingAgentPermission[],
  chatId: string | null | undefined,
): PendingAgentPermission[] {
  return chatId ? permissions.filter((item) => item.chatId === chatId) : [];
}
