import { extensionLoader } from "@/extensions/loader/extension-loader";
import { initializeExtensionStore } from "@/extensions/registry/extension-store";
import { initializeThemeSystem } from "@/extensions/themes/theme-initializer";
import { initializeUIExtensions } from "@/extensions/ui/services/ui-extension-initializer";
import { initializeWasmTokenizer } from "@/features/editor/lib/wasm-parser/wasm-parser-api";
import { initializeSettingsStore } from "@/features/settings/store";
import { initializeTelemetry } from "@/features/telemetry/services/telemetry";
import { reportBootstrapResults } from "./bootstrap-errors";

const asyncBootstrapSteps = [
  {
    name: "settings store",
    run: () => initializeSettingsStore(),
  },
  {
    name: "theme system",
    run: () => initializeThemeSystem(),
  },
  {
    name: "wasm tokenizer",
    run: () => initializeWasmTokenizer(),
  },
  {
    name: "extension loader",
    run: () => extensionLoader.initialize(),
  },
  {
    name: "extension store",
    run: () => initializeExtensionStore(),
  },
  {
    name: "telemetry",
    run: () => initializeTelemetry(),
  },
  {
    name: "ui extensions",
    run: () => initializeUIExtensions(),
  },
] as const;

export async function runAsyncBootstrapSteps(): Promise<void> {
  const results = await Promise.allSettled(asyncBootstrapSteps.map((step) => step.run()));
  reportBootstrapResults(asyncBootstrapSteps, results);
}
