const INSTALLED_BUNDLED_CONTRIBUTIONS_KEY = "athas.installedBundledContributionExtensions";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readInstalledBundledContributionExtensionIds(): Set<string> {
  if (!canUseStorage()) {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(INSTALLED_BUNDLED_CONTRIBUTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

function writeInstalledBundledContributionExtensionIds(extensionIds: Set<string>): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    INSTALLED_BUNDLED_CONTRIBUTIONS_KEY,
    JSON.stringify(Array.from(extensionIds).sort()),
  );
}

export function markBundledContributionExtensionInstalled(extensionId: string): void {
  const extensionIds = readInstalledBundledContributionExtensionIds();
  extensionIds.add(extensionId);
  writeInstalledBundledContributionExtensionIds(extensionIds);
}

export function markBundledContributionExtensionUninstalled(extensionId: string): void {
  const extensionIds = readInstalledBundledContributionExtensionIds();
  extensionIds.delete(extensionId);
  writeInstalledBundledContributionExtensionIds(extensionIds);
}
