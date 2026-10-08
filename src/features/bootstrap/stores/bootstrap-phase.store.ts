import { create } from "zustand";
import { traceWindowOpen } from "@/features/window/utils/window-open-diagnostics";
import { createSelectors } from "@/utils/zustand-selectors";

/** Startup phases in the order they are reached; see `initialize-app-bootstrap.ts`. */
export const BOOTSTRAP_PHASES = [
  "booting",
  "settings-ready",
  "workbench-ready",
  "extensions-ready",
] as const;

export type BootstrapPhase = (typeof BOOTSTRAP_PHASES)[number];

function getPhaseRank(phase: BootstrapPhase) {
  return BOOTSTRAP_PHASES.indexOf(phase);
}

export function isBootstrapPhaseReached(current: BootstrapPhase, phase: BootstrapPhase) {
  return getPhaseRank(current) >= getPhaseRank(phase);
}

interface BootstrapPhaseState {
  phase: BootstrapPhase;
  actions: {
    /** Moves startup forward to `phase`; a phase already reached or passed is ignored. */
    reachPhase: (phase: BootstrapPhase) => void;
  };
}

const useBootstrapPhaseStoreBase = create<BootstrapPhaseState>()((set, get) => ({
  phase: "booting",
  actions: {
    reachPhase: (phase) => {
      if (isBootstrapPhaseReached(get().phase, phase)) return;

      set({ phase });
      performance.mark(`athas:bootstrap:${phase}`);
      traceWindowOpen("bootstrap:phase", { phase });
    },
  },
}));

export const useBootstrapPhaseStore = createSelectors(useBootstrapPhaseStoreBase);

export function useBootstrapPhaseReached(phase: BootstrapPhase): boolean {
  return useBootstrapPhaseStore((state) => isBootstrapPhaseReached(state.phase, phase));
}

/** How long startup work waits for a phase before it gives up and runs anyway. */
export const BOOTSTRAP_PHASE_WAIT_TIMEOUT_MS = 10_000;

export function waitForBootstrapPhase(
  phase: BootstrapPhase,
  timeoutMs = BOOTSTRAP_PHASE_WAIT_TIMEOUT_MS,
): Promise<void> {
  if (isBootstrapPhaseReached(useBootstrapPhaseStore.getState().phase, phase)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = window.setTimeout(() => {
      console.warn(`Startup phase "${phase}" not reached after ${timeoutMs}ms; continuing.`);
      finish();
    }, timeoutMs);
    const unsubscribe = useBootstrapPhaseStore.subscribe((state) => {
      if (isBootstrapPhaseReached(state.phase, phase)) finish();
    });
  });
}
