import { reportBootstrapResults } from "./bootstrap-errors";

const asyncBootstrapSteps = [
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
    name: "extension loader",
    run: async () => {
      const { extensionLoader } = await import("@/extensions/loader/extension-loader");
      await extensionLoader.initialize();
    },
  },
  {
    name: "extension store",
    run: async () => {
      const { initializeExtensionStore } = await import("@/extensions/registry/extension-store");
      await initializeExtensionStore();
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

export async function runAsyncBootstrapSteps(): Promise<void> {
  const results = await Promise.allSettled(asyncBootstrapSteps.map((step) => step.run()));
  reportBootstrapResults(asyncBootstrapSteps, results);

  const extensionStoreResult = results[4];
  if (extensionStoreResult.status === "rejected") return;

  const uiExtensionSteps = [
    {
      name: "ui extensions",
      run: async () => {
        const { initializeUIExtensions } =
          await import("@/extensions/ui/services/ui-extension-initializer");
        await initializeUIExtensions();
      },
    },
  ] as const;
  const uiExtensionResults = await Promise.allSettled(uiExtensionSteps.map((step) => step.run()));
  reportBootstrapResults(uiExtensionSteps, uiExtensionResults);
}
