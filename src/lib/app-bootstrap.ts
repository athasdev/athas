import { enableMapSet } from "immer";
import { initializeIconThemes } from "@/extensions/icon-themes/icon-theme-initializer";
import { extensionLoader } from "@/extensions/loader/extension-loader";
import { initializeExtensionStore } from "@/extensions/registry/extension-store";
import { initializeThemeSystem } from "@/extensions/themes/theme-initializer";
import { initializeWasmTokenizer } from "@/features/editor/lib/wasm-parser/wasm-parser-api";
import { initializeKeymaps } from "@/features/keymaps/init";
import { ensureStartupAppearanceApplied } from "@/features/settings/lib/appearance-bootstrap";
import { initializeSettingsStore } from "@/features/settings/store";
import { initializeHeartbeat } from "@/features/telemetry/services/heartbeat";
import { initializeUIExtensions } from "@/extensions/ui/services/ui-extension-initializer";

let appBootstrapPromise: Promise<void> | null = null;

function logBootstrapError(step: string, error: unknown) {
  console.error(`App bootstrap failed during ${step}:`, error);
}

export function initializeAppBootstrap(): Promise<void> {
  if (appBootstrapPromise) {
    return appBootstrapPromise;
  }

  ensureStartupAppearanceApplied();
  enableMapSet();
  initializeIconThemes();
  initializeKeymaps();

  appBootstrapPromise = Promise.allSettled([
    initializeSettingsStore(),
    initializeThemeSystem(),
    initializeWasmTokenizer(),
    extensionLoader.initialize(),
    initializeExtensionStore(),
    initializeHeartbeat(),
    initializeUIExtensions(),
  ]).then((results) => {
    const bootstrapSteps = [
      "settings store",
      "theme system",
      "wasm tokenizer",
      "extension loader",
      "extension store",
      "heartbeat",
      "ui extensions",
    ] as const;

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logBootstrapError(bootstrapSteps[index], result.reason);
      }
    });
  });

  return appBootstrapPromise;
}
