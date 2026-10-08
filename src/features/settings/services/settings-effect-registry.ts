import type { Settings } from "../types/settings.types";

/**
 * Side effects other features run when settings apply: all at once when the settings load (or are
 * imported or reset), and per key when one setting changes. Features register from a module every
 * window runs at startup (`bootstrap/services/initialize-app-bootstrap.ts`). An effect registered
 * after the settings were applied runs on them right away, so registration order never matters.
 */
export interface SettingsEffect {
  applyAll: (settings: Settings) => void;
  applyChange?: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const effects: SettingsEffect[] = [];
let appliedSettings: Settings | null = null;

export function registerSettingsEffect(effect: SettingsEffect) {
  if (effects.includes(effect)) return;
  effects.push(effect);
  if (appliedSettings) effect.applyAll(appliedSettings);
}

export function runSettingsEffects(settings: Settings) {
  appliedSettings = settings;
  for (const effect of effects) effect.applyAll(settings);
}

export function runSettingEffect<K extends keyof Settings>(key: K, value: Settings[K]) {
  for (const effect of effects) effect.applyChange?.(key, value);
}
