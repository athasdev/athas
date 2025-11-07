import { type Platform, platform, type as platformType } from "@tauri-apps/plugin-os";

/**
 * Async function to detect platform
 */
export const detectPlatform = async (): Promise<Platform> => {
  return await platform();
};

/**
 * Synchronous function to check if current platform is macOS
 * Uses the synchronous type() API from Tauri
 */
export const isMac = (): boolean => {
  return platformType() === "macos";
};
