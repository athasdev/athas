import { getVersion } from "@tauri-apps/api/app";

/**
 * Fetches the raw application version from Tauri API without 'v' prefix
 * @returns Promise<string> - Raw application version (e.g., "1.0.0")
 */
export const fetchRawAppVersion = async (): Promise<string> => {
  try {
    const hasTauri =
      typeof (window as any)?.__TAURI_INTERNALS__ !== "undefined" ||
      typeof (window as any)?.__TAURI__ !== "undefined";
    if (!hasTauri) {
      // Browser dev fallback
      return "0.1.0";
    }
    const version = await getVersion();
    return version;
  } catch (error) {
    console.error("Failed to fetch app version:", error);
    // Return default version if fetching fails
    return "0.1.0";
  }
};
