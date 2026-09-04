import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export const useAgentWindowStore = createSelectors(
  create<{
    status: "attached" | "opening" | "detached";
    actions: { setStatus: (status: "attached" | "opening" | "detached") => void };
  }>((set) => ({
    status: "attached",
    actions: { setStatus: (status) => set({ status }) },
  })),
);

export function agentsAreDetached() {
  return useAgentWindowStore.getState().status !== "attached";
}
