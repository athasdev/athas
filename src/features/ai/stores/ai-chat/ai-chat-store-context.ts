import type { Draft } from "immer";
import type { AIChatStore } from "./ai-chat-store.types";

export type SetAIChatStore = (update: (state: Draft<AIChatStore>) => void) => void;
export type GetAIChatStore = () => AIChatStore;
