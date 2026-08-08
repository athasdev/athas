import { load, type Store } from "@tauri-apps/plugin-store";
import isEqual from "fast-deep-equal";
import {
  defaultSettings,
  getDefaultSettingsSnapshot,
} from "@/features/settings/config/default-settings";
import type { Settings } from "@/features/settings/types/settings.types";

let storeInstance: Store | null = null;
let storePromise: Promise<Store> | null = null;
let initialStoreEntries: Map<string, unknown> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function initializeStoreDefaults(store: Store) {
  const entries = new Map(await store.entries<unknown>());
  const changes: Array<[string, unknown]> = [];

  for (const [key, defaultValue] of Object.entries(defaultSettings)) {
    const currentValue = entries.get(key);
    let nextValue = currentValue;

    if (currentValue === null || currentValue === undefined) {
      nextValue = defaultValue;
    } else if (isRecord(defaultValue)) {
      nextValue = isRecord(currentValue) ? { ...defaultValue, ...currentValue } : defaultValue;
    }

    entries.set(key, nextValue);
    if (!isEqual(currentValue, nextValue)) changes.push([key, nextValue]);
  }

  if (changes.length > 0) {
    await Promise.all(changes.map(([key, value]) => store.set(key, value)));
    await store.save();
  }

  initialStoreEntries = entries;
}

export async function getSettingsStore() {
  if (storeInstance) return storeInstance;

  if (!storePromise) {
    storePromise = (async () => {
      const store = await load("settings.json", {
        autoSave: true,
      } as Parameters<typeof load>[1]);
      await initializeStoreDefaults(store);
      storeInstance = store;
      return store;
    })();
  }

  try {
    return await storePromise;
  } catch (error) {
    storePromise = null;
    throw error;
  }
}

export async function loadSettingsFromStore(): Promise<Settings> {
  const store = await getSettingsStore();
  const loadedSettings = getDefaultSettingsSnapshot();
  const entries = initialStoreEntries ?? new Map(await store.entries<unknown>());
  initialStoreEntries = null;

  for (const key of Object.keys(defaultSettings) as Array<keyof Settings>) {
    const value = entries.get(key);
    if (value !== null && value !== undefined) {
      (loadedSettings as Record<keyof Settings, Settings[keyof Settings]>)[key] =
        value as Settings[typeof key];
    }
  }

  return loadedSettings;
}

export async function saveSettingsToStore(settings: Partial<Settings>) {
  try {
    const store = await getSettingsStore();

    await Promise.all(Object.entries(settings).map(([key, value]) => store.set(key, value)));

    await store.save();
  } catch (error) {
    console.error("Failed to save settings to store:", error);
  }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSettings: Partial<Settings> = {};

export function debouncedSaveSettingsToStore(settings: Partial<Settings>) {
  pendingSettings = { ...pendingSettings, ...settings };

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    const settingsToSave = pendingSettings;
    pendingSettings = {};
    saveTimeout = null;
    void saveSettingsToStore(settingsToSave);
  }, 300);
}
