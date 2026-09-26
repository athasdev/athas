import { create } from "zustand";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
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
 * the setting is the default for new chats and the toggle overrides it for one chat. A toggle is
 * also saved with the chat's session settings, so it survives app launches.
 */
const useAgentFollowStoreBase = create<AgentFollowState>()((set) => ({
  following: {},
  actions: {
    setFollowing: (chatId, following) => {
      set((state) =>
        state.following[chatId] === following
          ? state
          : { following: { ...state.following, [chatId]: following } },
      );
      useAIChatStore.getState().actions.setChatFollowAgent(chatId, following);
    },
  },
}));

function savedFollowAgent(
  chats: ReadonlyArray<{ id: string; sessionSettings?: { followAgent?: boolean } | null }>,
  chatId: string | null | undefined,
): boolean | undefined {
  if (!chatId) return undefined;
  return chats.find((chat) => chat.id === chatId)?.sessionSettings?.followAgent;
}

export const useAgentFollowStore = createSelectors(useAgentFollowStoreBase);

/** This launch's toggle, else the one saved with the chat, else the setting. */
export function selectIsFollowingAgent(
  following: Record<string, boolean>,
  chatId: string | null | undefined,
  followByDefault: boolean,
  saved?: boolean,
): boolean {
  if (!chatId) return false;
  return following[chatId] ?? saved ?? followByDefault;
}

export function isFollowingAgent(chatId: string | null | undefined): boolean {
  return selectIsFollowingAgent(
    useAgentFollowStore.getState().following,
    chatId,
    useSettingsStore.getState().settings.aiFollowAgent,
    savedFollowAgent(useAIChatStore.getState().chats, chatId),
  );
}

/** Whether the chat follows the agent, re-rendering when the toggle or the setting changes. */
export function useIsFollowingAgent(chatId: string | null | undefined): boolean {
  const following = useAgentFollowStore((state) => state.following);
  const followByDefault = useSettingsStore((state) => state.settings.aiFollowAgent);
  const saved = useAIChatStore((state) => savedFollowAgent(state.chats, chatId));
  return selectIsFollowingAgent(following, chatId, followByDefault, saved);
}
