import { reportBootstrapResults } from "./bootstrap-errors";
import { useBootstrapPhaseStore } from "./stores/bootstrap-phase.store";

const foundationalBootstrapSteps = [
  {
    name: "theme system",
    run: async () => {
      const { initializeThemeSystem } = await import("@/extensions/themes/theme-initializer");
      await initializeThemeSystem();
    },
  },
  {
    name: "telemetry",
    run: async () => {
      const { initializeTelemetry } = await import("@/features/telemetry/services/telemetry");
      await initializeTelemetry();
    },
  },
] as const;

const extensionBootstrapSteps = [
  {
    name: "integration runtime",
    run: async () => {
      const { initializeExtensionRuntime } = await import("@/extensions/runtime/extension-runtime");
      await initializeExtensionRuntime();
    },
  },
] as const;

/** `settingsLoaded` is the settings load `main.tsx` already started. */
export async function runAsyncBootstrapSteps(settingsLoaded: Promise<void>): Promise<void> {
  const steps = [{ name: "settings store" }, ...foundationalBootstrapSteps];
  const foundationalResults = await Promise.allSettled([
    settingsLoaded,
    ...foundationalBootstrapSteps.map((step) => step.run()),
  ]);
  reportBootstrapResults(steps, foundationalResults);
  useBootstrapPhaseStore.getState().actions.reachPhase("workbench-ready");

  const extensionResults = await Promise.allSettled(
    extensionBootstrapSteps.map((step) => step.run()),
  );
  reportBootstrapResults(extensionBootstrapSteps, extensionResults);
  useBootstrapPhaseStore.getState().actions.reachPhase("extensions-ready");
}
