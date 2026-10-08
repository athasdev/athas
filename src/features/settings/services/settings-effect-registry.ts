import type { Settings } from "../types/settings.types";

/**
 * Side effects other features run when settings apply: all at once when the settings load (or are
 * imported or reset), and per key when one setting changes. Features register from a module every
 * window runs at startup (`bootstrap/services/initialize-app-bootstrap.ts`). An effect registered
 * after the settings were applied runs on them right away, so registration order never matters.
 * Effects are keyed by a stable id, so a module that runs again (hot reload) replaces its effect
 * instead of adding a second one.
 */
export interface SettingsEffect {
  applyAll: (settings: Settings) => void;
  applyChange?: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const effects = new Map<string, SettingsEffect>();
let appliedSettings: Settings | null = null;

export function registerSettingsEffect(id: string, effect: SettingsEffect) {
  if (effects.get(id) === effect) return;
  effects.set(id, effect);
  if (appliedSettings) effect.applyAll(appliedSettings);
}

export function runSettingsEffects(settings: Settings) {
  appliedSettings = settings;
  for (const effect of effects.values()) effect.applyAll(settings);
}

export function runSettingEffect<K extends keyof Settings>(key: K, value: Settings[K]) {
  // Kept current so an effect registered later starts from this value, not the one loaded.
  if (appliedSettings) appliedSettings = { ...appliedSettings, [key]: value };
  for (const effect of effects.values()) effect.applyChange?.(key, value);
}
