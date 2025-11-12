import { type Platform, platform } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";

/**
 * Get platform from navigator.userAgent as fallback
 */
const getPlatformFromNavigator = (): Platform => {
  if (typeof navigator === "undefined") {
    return "linux";
  }

  if (navigator.userAgent.includes("Mac")) {
    return "macos";
  }
  if (navigator.userAgent.includes("Linux")) {
    return "linux";
  }
  if (navigator.userAgent.includes("Windows")) {
    return "windows";
  }

  return "linux";
};

/**
 * Hook to detect the current platform
 * @returns The current platform (macos, windows, linux, etc.)
 */
export const usePlatform = () => {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>(() =>
    getPlatformFromNavigator(),
  );

  useEffect(() => {
    const detectPlatform = async () => {
      try {
        const platformName = await platform();
        setCurrentPlatform(platformName);
      } catch (error) {
        console.error("Error detecting platform:", error);
        setCurrentPlatform(getPlatformFromNavigator());
      }
    };

    detectPlatform();
  }, []);

  return currentPlatform;
};

/**
 * Check if the current platform is macOS
 */
export const useIsMac = () => {
  const currentPlatform = usePlatform();
  return currentPlatform === "macos";
};

/**
 * Check if the current platform is Windows
 */
export const useIsWindows = () => {
  const currentPlatform = usePlatform();
  return currentPlatform === "windows";
};

/**
 * Check if the current platform is Linux
 */
export const useIsLinux = () => {
  const currentPlatform = usePlatform();
  return currentPlatform === "linux";
};
