const DISABLED_EXTENSION_IDS_KEY = "athas.disabledExtensions";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readDisabledExtensionIds(): Set<string> {
  if (!canUseStorage()) {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(DISABLED_EXTENSION_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

function writeDisabledExtensionIds(extensionIds: Set<string>): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    DISABLED_EXTENSION_IDS_KEY,
    JSON.stringify(Array.from(extensionIds).sort()),
  );
}

export function markExtensionEnabled(extensionId: string): void {
  const extensionIds = readDisabledExtensionIds();
  extensionIds.delete(extensionId);
  writeDisabledExtensionIds(extensionIds);
}

export function markExtensionDisabled(extensionId: string): void {
  const extensionIds = readDisabledExtensionIds();
  extensionIds.add(extensionId);
  writeDisabledExtensionIds(extensionIds);
}
