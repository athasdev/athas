import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export type IntelligenceCompletionPauseReason = "credits" | "sign-in" | "api-key" | "policy";

export type IntelligenceCompletionStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "paused"; reason: IntelligenceCompletionPauseReason; message: string }
  | { kind: "error"; message: string };

interface IntelligenceCompletionState {
  status: IntelligenceCompletionStatus;
  pending: number;
  actions: {
    requestStarted: () => void;
    requestFinished: () => void;
    fail: (message: string) => void;
    pause: (reason: IntelligenceCompletionPauseReason, message: string) => void;
    resume: () => void;
  };
}

const IDLE: IntelligenceCompletionStatus = { kind: "idle" };

const useIntelligenceCompletionStoreBase = create<IntelligenceCompletionState>((set) => ({
  status: IDLE,
  pending: 0,
  actions: {
    requestStarted: () =>
      set((state) =>
        state.status.kind === "paused"
          ? state
          : { pending: state.pending + 1, status: { kind: "loading" } },
      ),
    requestFinished: () =>
      set((state) => {
        const pending = Math.max(0, state.pending - 1);
        return {
          pending,
          status: state.status.kind === "loading" && pending === 0 ? IDLE : state.status,
        };
      }),
    fail: (message) =>
      set((state) =>
        state.status.kind === "paused" ? state : { status: { kind: "error", message } },
      ),
    pause: (reason, message) => set({ status: { kind: "paused", reason, message } }),
    resume: () => set({ status: IDLE, pending: 0 }),
  },
}));

export const useIntelligenceCompletionStore = createSelectors(useIntelligenceCompletionStoreBase);
