import { useMemo, useSyncExternalStore } from "react";
import {
  codexSettingsKey,
  codexSettingsChanged,
  defaultCodexSettings,
  saveCodexSettings,
  getCodexSettings,
} from "./codex-integration-service";
import type { CodexThreadSettings } from "./codex-types";

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === codexSettingsKey || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(codexSettingsChanged, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(codexSettingsChanged, listener);
  };
}

function snapshot() {
  return JSON.stringify(getCodexSettings());
}

export function useCodexSettings() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => JSON.stringify(defaultCodexSettings));
  const settings = useMemo(() => JSON.parse(raw) as CodexThreadSettings, [raw]);
  const update = (patch: Partial<CodexThreadSettings>) =>
    saveCodexSettings({ ...getCodexSettings(), ...patch });
  return { settings, update };
}
