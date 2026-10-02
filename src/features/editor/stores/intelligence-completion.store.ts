import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

export type IntelligenceCompletionPauseReason =
  | "credits"
  | "sign-in"
  | "api-key"
  | "policy"
  | "model";

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
    // Every request is counted, even one that starts while paused, so the count stays right
    // when its finish arrives after a resume.
    requestStarted: () =>
      set((state) => ({
        pending: state.pending + 1,
        status: state.status.kind === "paused" ? state.status : { kind: "loading" },
      })),
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
    // Requests still in flight finish on their own, so their count is kept.
    resume: () => set((state) => ({ status: state.pending > 0 ? { kind: "loading" } : IDLE })),
  },
}));

export const useIntelligenceCompletionStore = createSelectors(useIntelligenceCompletionStoreBase);
