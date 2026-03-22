import { enableMapSet } from "immer";
import { extensionLoader } from "@/extensions/loader/extension-loader";
import { initializeExtensionStore } from "@/extensions/registry/extension-store";
import { initializeIconThemes } from "@/extensions/icon-themes/icon-theme-initializer";
import { initializeThemeSystem } from "@/extensions/themes/theme-initializer";
import { initializeWasmTokenizer } from "@/features/editor/lib/wasm-parser/wasm-parser-api";
import { initializeKeymaps } from "@/features/keymaps/init";
import { ensureStartupAppearanceApplied } from "@/features/settings/lib/appearance-bootstrap";
import { initializeSettingsStore } from "@/features/settings/store";

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
  ]).then((results) => {
    const bootstrapSteps = [
      "settings store",
      "theme system",
      "wasm tokenizer",
      "extension loader",
      "extension store",
    ] as const;

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logBootstrapError(bootstrapSteps[index], result.reason);
      }
    });
  });

  return appBootstrapPromise;
}
