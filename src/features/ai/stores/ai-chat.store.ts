import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { createAcpActions } from "./ai-chat/acp-actions";
import { createChatActions } from "./ai-chat/chat-actions";
import { createInitialAIChatState } from "./ai-chat/ai-chat-state";
import type { AIChatState, AIChatStore } from "./ai-chat/ai-chat-store.types";
import { createProviderActions } from "./ai-chat/provider-actions";

const useAIChatStoreBase = create<AIChatStore>()(
  persist(
    immer((set, get) => ({
      ...createInitialAIChatState(),
      actions: {
        ...createChatActions(set, get),
        ...createProviderActions(set, get),
        ...createAcpActions(set, get),
      },
    })),
    {
      name: "athas-ai-chat-settings-v7",
      version: 3,
      partialize: (state) => ({
        mode: state.mode,
        outputStyle: state.outputStyle,
        selectedAgentId: state.selectedAgentId,
        sessionModeState: state.sessionModeState,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AIChatState> | undefined;
        return {
          ...currentState,
          mode: persisted?.mode ?? "chat",
          outputStyle: persisted?.outputStyle ?? "default",
          selectedAgentId: persisted?.selectedAgentId ?? "custom",
          sessionModeState: persisted?.sessionModeState ?? {
            currentModeId: null,
            availableModes: [],
          },
          acpStatus: null,
        };
      },
    },
  ),
);

export const useAIChatStore = createSelectors(useAIChatStoreBase);
