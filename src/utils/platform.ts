import { arch, type Platform, platform } from "@tauri-apps/plugin-os";

import type { Platform as NodePlatform, PlatformArch } from "@/extensions/types/extension-manifest";

/**
 * Single source of truth for platform detection.
 * The Tauri v2 `platform()` call is synchronous — evaluated once at module load.
 */
export const currentPlatform: Platform = platform();

export const IS_MAC: boolean = currentPlatform === "macos";
export const IS_WINDOWS: boolean = currentPlatform === "windows";
export const IS_LINUX: boolean = currentPlatform === "linux";

export function isMac(): boolean {
  return IS_MAC;
}

export function isWindows(): boolean {
  return IS_WINDOWS;
}

export function isLinux(): boolean {
  return IS_LINUX;
}

/**
 * Normalize key combination for current platform.
 * Converts 'cmd' to 'ctrl' on Windows/Linux.
 */
export function normalizeKey(key: string): string {
  if (IS_MAC) return key;
  return key.replace(/\bcmd\b/gi, "ctrl");
}

/**
 * Get platform-specific modifier key name.
 * Returns 'cmd' on Mac, 'ctrl' on Windows/Linux.
 */
export function getModifierKey(): "cmd" | "ctrl" {
  return IS_MAC ? "cmd" : "ctrl";
}

/**
 * Node.js-style platform name used by the extension system.
 * Maps Tauri's "macos"→"darwin", "windows"→"win32", others pass through.
 */
export const NODE_PLATFORM: NodePlatform = IS_MAC ? "darwin" : IS_WINDOWS ? "win32" : "linux";

/**
 * Current CPU architecture from the Tauri OS plugin (synchronous).
 */
export const ARCH: string = arch();

/**
 * Platform+architecture identifier for extension CDN packages.
 */
export const PLATFORM_ARCH: PlatformArch = (() => {
  const isArm = ARCH === "aarch64" || ARCH === "arm";
  if (IS_MAC) return isArm ? "darwin-arm64" : "darwin-x64";
  if (IS_LINUX) return isArm ? "linux-arm64" : "linux-x64";
  return "win32-x64";
})();
