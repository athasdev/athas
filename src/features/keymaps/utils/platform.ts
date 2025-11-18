/**
 * Platform detection and key normalization utilities
 */

type Platform = "mac" | "win" | "linux";

let cachedPlatform: Platform | null = null;

export function getPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform;

  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes("mac")) {
    cachedPlatform = "mac";
  } else if (userAgent.includes("win")) {
    cachedPlatform = "win";
  } else {
    cachedPlatform = "linux";
  }

  return cachedPlatform;
}

export function isMac(): boolean {
  return getPlatform() === "mac";
}

export function isWindows(): boolean {
  return getPlatform() === "win";
}

export function isLinux(): boolean {
  return getPlatform() === "linux";
}

/**
 * Normalize key combination for current platform
 * Converts 'cmd' to 'ctrl' on Windows/Linux
 */
export function normalizeKey(key: string): string {
  if (isMac()) return key;

  return key.replace(/\bcmd\b/gi, "ctrl");
}

/**
 * Get platform-specific modifier key name
 * Returns 'cmd' on Mac, 'ctrl' on Windows/Linux
 */
export function getModifierKey(): "cmd" | "ctrl" {
  return isMac() ? "cmd" : "ctrl";
}
