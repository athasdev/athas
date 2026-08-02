import { arch, type Platform, platform } from "@tauri-apps/plugin-os";

import type { Platform as NodePlatform, PlatformArch } from "@/extensions/types/extension-manifest";

/**
 * Single source of truth for platform detection.
 * The Tauri v2 `platform()` call is synchronous — evaluated once at module load.
 * Falls back to a sensible default when evaluated outside a browser/webview
 * (for example during unit tests in node) so modules that transitively import
 * from platform can still load without a window reference.
 */
function detectPlatform(): Platform {
  if (typeof window === "undefined") {
    if (typeof process !== "undefined" && process.platform) {
      if (process.platform === "darwin") return "macos";
      if (process.platform === "win32") return "windows";
      if (process.platform === "linux") return "linux";
    }
    return "macos";
  }

  try {
    return platform();
  } catch {
    return "macos";
  }
}

export const currentPlatform: Platform = detectPlatform();

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
 * Node.js-style platform name used by the extension system.
 * Maps Tauri's "macos"→"darwin", "windows"→"win32", others pass through.
 */
export const NODE_PLATFORM: NodePlatform = IS_MAC ? "darwin" : IS_WINDOWS ? "win32" : "linux";

/**
 * Current CPU architecture from the Tauri OS plugin (synchronous).
 * Falls back to a default when evaluated outside a webview so tests can
 * still load modules that transitively import platform.
 */
function detectArch(): string {
  if (typeof window === "undefined") {
    if (typeof process !== "undefined" && process.arch) {
      return process.arch === "arm64" ? "aarch64" : process.arch;
    }
    return "aarch64";
  }

  try {
    return arch();
  } catch {
    return "aarch64";
  }
}

const ARCH: string = detectArch();

/**
 * Platform+architecture identifier for extension CDN packages.
 */
export const PLATFORM_ARCH: PlatformArch = (() => {
  const isArm = ARCH === "aarch64" || ARCH === "arm";
  if (IS_MAC) return isArm ? "darwin-arm64" : "darwin-x64";
  if (IS_LINUX) return isArm ? "linux-arm64" : "linux-x64";
  return "win32-x64";
})();
