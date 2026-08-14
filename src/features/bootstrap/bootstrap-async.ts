import { reportBootstrapResults } from "./bootstrap-errors";

const foundationalBootstrapSteps = [
  {
    name: "settings store",
    run: async () => {
      const { initializeSettingsStore } = await import("@/features/settings/stores/settings.store");
      await initializeSettingsStore();
    },
  },
  {
    name: "theme system",
    run: async () => {
      const { initializeThemeSystem } = await import("@/extensions/themes/theme-initializer");
      await initializeThemeSystem();
    },
  },
  {
    name: "wasm tokenizer",
    run: async () => {
      const { initializeWasmTokenizer } =
        await import("@/features/editor/lib/wasm-parser/wasm-parser-api");
      await initializeWasmTokenizer();
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
    name: "extension runtime",
    run: async () => {
      const { initializeExtensionRuntime } = await import("@/extensions/runtime/extension-runtime");
      await initializeExtensionRuntime();
    },
  },
] as const;

export async function runAsyncBootstrapSteps(): Promise<void> {
  const foundationalResults = await Promise.allSettled(
    foundationalBootstrapSteps.map((step) => step.run()),
  );
  reportBootstrapResults(foundationalBootstrapSteps, foundationalResults);

  const extensionResults = await Promise.allSettled(
    extensionBootstrapSteps.map((step) => step.run()),
  );
  reportBootstrapResults(extensionBootstrapSteps, extensionResults);
}
