const STORAGE_KEY = "athas-update-preferences";

const DEFAULT_REMIND_LATER_MS = 24 * 60 * 60 * 1000;

export const UPDATE_DISMISSED_EVENT = "athas:update-dismissed";
export const UPDATE_PREFERENCES_CHANGED_EVENT = "athas:update-preferences-changed";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface UpdatePreferenceTarget {
  version: string;
}

export interface UpdatePreferences {
  skippedVersion?: string;
  remindVersion?: string;
  remindAfter?: number;
}

function getStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function dispatchUpdateEvent(eventName: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(eventName));
}

export function readUpdatePreferences(
  storage: StorageLike | null = getStorage(),
): UpdatePreferences {
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as UpdatePreferences;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeUpdatePreferences(
  preferences: UpdatePreferences,
  storage: StorageLike | null = getStorage(),
) {
  if (!storage) {
    return;
  }

  try {
    const hasPreferences = Boolean(
      preferences.skippedVersion || preferences.remindVersion || preferences.remindAfter,
    );

    if (!hasPreferences) {
      storage.removeItem(STORAGE_KEY);
      dispatchUpdateEvent(UPDATE_PREFERENCES_CHANGED_EVENT);
      return;
    }

    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    dispatchUpdateEvent(UPDATE_PREFERENCES_CHANGED_EVENT);
  } catch {
    // Ignore localStorage failures.
  }
}

export function notifyUpdateDismissed() {
  dispatchUpdateEvent(UPDATE_DISMISSED_EVENT);
}

export function shouldSuppressUpdate(
  update: UpdatePreferenceTarget,
  now = Date.now(),
  preferences = readUpdatePreferences(),
) {
  if (preferences.skippedVersion === update.version) {
    return true;
  }

  return (
    preferences.remindVersion === update.version &&
    typeof preferences.remindAfter === "number" &&
    preferences.remindAfter > now
  );
}

export function skipUpdateVersion(update: UpdatePreferenceTarget) {
  writeUpdatePreferences({
    skippedVersion: update.version,
  });
}

export function remindAboutUpdateLater(
  update: UpdatePreferenceTarget,
  now = Date.now(),
  delayMs = DEFAULT_REMIND_LATER_MS,
) {
  writeUpdatePreferences({
    skippedVersion: undefined,
    remindVersion: update.version,
    remindAfter: now + delayMs,
  });
}

export function clearUpdatePreferencesForNewVersion(update: UpdatePreferenceTarget) {
  const preferences = readUpdatePreferences();
  const nextPreferences = { ...preferences };
  let changed = false;

  if (preferences.skippedVersion && preferences.skippedVersion !== update.version) {
    nextPreferences.skippedVersion = undefined;
    changed = true;
  }

  if (preferences.remindVersion && preferences.remindVersion !== update.version) {
    nextPreferences.remindVersion = undefined;
    nextPreferences.remindAfter = undefined;
    changed = true;
  }

  if (changed) {
    writeUpdatePreferences(nextPreferences);
  }
}
