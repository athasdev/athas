import { enableMapSet } from "immer";
import { traceWindowOpen } from "@/features/window/services/window-open-diagnostics";
import {
  BOOTSTRAP_PHASE_WAIT_TIMEOUT_MS,
  useBootstrapPhaseStore,
} from "../stores/bootstrap-phase.store";

/*
 * Startup order. Each phase is recorded in the bootstrap phase store and traced as
 * `bootstrap:phase` (with a matching `athas:bootstrap:<phase>` performance mark).
 *
 * 1. booting — `main.tsx` calls `startSettingsLoad` and begins the window's terminal session at
 *    module scope, so both run while React paints the window shell and loads the workbench chunk.
 *    The workbench renders without waiting for either.
 * 2. settings-ready — the saved settings are in the settings store and applied. Startup work that
 *    would otherwise act on the defaults waits for it: `SettingsReadyBootstrap` (settings sync,
 *    font fallback, native menu state, system accessibility), the workspace restore in
 *    `MainLayout`, and window open requests. It is also reached when loading fails or takes over
 *    10 s; the settings store then keeps `isLoaded: false`, and settings sync and the font
 *    fallback write nothing back.
 * 3. workbench-ready — after the workbench's first frame, `initializeAppBootstrap` registers icon
 *    themes and keymaps, then the theme system and telemetry start; the phase is reached once those
 *    and the settings have settled.
 * 4. extensions-ready — the extension runtime has started.
 *
 * Terminals wait for the terminal session on their own (`getFrontendTerminalSessionArgs`).
 */

let settingsLoadPromise: Promise<void> | null = null;
let appBootstrapPromise: Promise<void> | null = null;

enableMapSet();

export function startSettingsLoad(): Promise<void> {
  if (settingsLoadPromise) {
    return settingsLoadPromise;
  }

  const startedAt = performance.now();
  const { reachPhase } = useBootstrapPhaseStore.getState().actions;
  traceWindowOpen("bootstrap:settings:start");
  // A settings load that never settles must not hold back the work gated on it forever; that work
  // then runs on the defaults, and the settings store stays not loaded.
  const timeout = window.setTimeout(() => {
    console.warn(`Settings did not load within ${BOOTSTRAP_PHASE_WAIT_TIMEOUT_MS}ms; continuing.`);
    reachPhase("settings-ready");
  }, BOOTSTRAP_PHASE_WAIT_TIMEOUT_MS);
  // The settings effects other features contribute register before the settings apply.
  settingsLoadPromise = Promise.all([
    import("@/features/settings/stores/settings.store"),
    import("@/features/ai/services/ai-settings-effects"),
  ])
    .then(async ([{ initializeSettingsStore }, { registerAiSettingsEffects }]) => {
      registerAiSettingsEffects();
      await initializeSettingsStore();
    })
    .finally(() => {
      window.clearTimeout(timeout);
      traceWindowOpen("bootstrap:settings:end", {
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      });
      reachPhase("settings-ready");
    });

  return settingsLoadPromise;
}

export function initializeAppBootstrap(): Promise<void> {
  if (appBootstrapPromise) {
    return appBootstrapPromise;
  }

  const settingsLoaded = startSettingsLoad();
  appBootstrapPromise = Promise.all([
    import("../bootstrap-sync"),
    import("../bootstrap-async"),
  ]).then(async ([{ runSynchronousBootstrapSteps }, { runAsyncBootstrapSteps }]) => {
    runSynchronousBootstrapSteps();
    await runAsyncBootstrapSteps(settingsLoaded);
  });

  return appBootstrapPromise;
}
