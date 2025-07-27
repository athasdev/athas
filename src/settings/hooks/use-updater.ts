import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
}

export interface UpdateState {
  available: boolean;
  checking: boolean;
  downloading: boolean;
  installing: boolean;
  error: string | null;
  updateInfo: UpdateInfo | null;
}

export const useUpdater = (checkOnMount = true) => {
  const [state, setState] = useState<UpdateState>({
    available: false,
    checking: false,
    downloading: false,
    installing: false,
    error: null,
    updateInfo: null,
  });

  const checkForUpdates = async () => {
    try {
      setState((prev) => ({ ...prev, checking: true, error: null }));

      const update = await check();

      if (update?.available) {
        setState((prev) => ({
          ...prev,
          available: true,
          checking: false,
          updateInfo: {
            version: update.version,
            currentVersion: update.currentVersion,
            body: update.body,
            date: update.date,
          },
        }));
      } else {
        setState((prev) => ({
          ...prev,
          available: false,
          checking: false,
          updateInfo: null,
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        checking: false,
        error: error instanceof Error ? error.message : "Failed to check for updates",
      }));
    }
  };

  const downloadAndInstall = async () => {
    if (!state.updateInfo) return;

    try {
      setState((prev) => ({ ...prev, downloading: true, error: null }));

      const update = await check();
      if (!update?.available) {
        throw new Error("No update available");
      }

      setState((prev) => ({ ...prev, downloading: false, installing: true }));

      await update.downloadAndInstall();

      setState((prev) => ({ ...prev, installing: false }));

      // Relaunch the app to apply the update
      await relaunch();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        downloading: false,
        installing: false,
        error: error instanceof Error ? error.message : "Failed to install update",
      }));
    }
  };

  const dismissUpdate = () => {
    setState((prev) => ({
      ...prev,
      available: false,
      updateInfo: null,
      error: null,
    }));
  };

  // Check for updates on mount if enabled
  useEffect(() => {
    if (checkOnMount) {
      checkForUpdates();
    }
  }, [checkOnMount]);

  return {
    ...state,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
};
