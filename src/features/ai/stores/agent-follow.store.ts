import { create } from "zustand";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { createSelectors } from "@/utils/zustand-selectors";

interface AgentFollowState {
  /** Chats whose follow toggle the user (or a manual edit) set, by chat id. */
  following: Record<string, boolean>;
  actions: {
    setFollowing: (chatId: string, following: boolean) => void;
  };
}

/**
 * Per-chat "Follow agent" toggles. A chat nobody toggled uses the `aiFollowAgent` setting, so
 * the setting is the default for new chats and the toggle overrides it for one chat.
 */
const useAgentFollowStoreBase = create<AgentFollowState>()((set) => ({
  following: {},
  actions: {
    setFollowing: (chatId, following) =>
      set((state) =>
        state.following[chatId] === following
          ? state
          : { following: { ...state.following, [chatId]: following } },
      ),
  },
}));

export const useAgentFollowStore = createSelectors(useAgentFollowStoreBase);

export function selectIsFollowingAgent(
  following: Record<string, boolean>,
  chatId: string | null | undefined,
  followByDefault: boolean,
): boolean {
  if (!chatId) return false;
  return following[chatId] ?? followByDefault;
}

export function isFollowingAgent(chatId: string | null | undefined): boolean {
  return selectIsFollowingAgent(
    useAgentFollowStore.getState().following,
    chatId,
    useSettingsStore.getState().settings.aiFollowAgent,
  );
}

/** Whether the chat follows the agent, re-rendering when the toggle or the setting changes. */
export function useIsFollowingAgent(chatId: string | null | undefined): boolean {
  const following = useAgentFollowStore((state) => state.following);
  const followByDefault = useSettingsStore((state) => state.settings.aiFollowAgent);
  return selectIsFollowingAgent(following, chatId, followByDefault);
}
