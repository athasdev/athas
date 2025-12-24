import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
}

export interface DownloadProgress {
  contentLength: number;
  downloaded: number;
  percentage: number;
}

export interface UpdateState {
  available: boolean;
  checking: boolean;
  downloading: boolean;
  installing: boolean;
  error: string | null;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
}

export const useUpdater = (checkOnMount = true) => {
  const [state, setState] = useState<UpdateState>({
    available: false,
    checking: false,
    downloading: false,
    installing: false,
    error: null,
    updateInfo: null,
    downloadProgress: null,
  });

  const updateRef = useRef<Update | null>(null);

  const checkForUpdates = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, checking: true, error: null }));

      const update = await check();
      updateRef.current = update;

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
        return true;
      }

      setState((prev) => ({
        ...prev,
        available: false,
        checking: false,
        updateInfo: null,
      }));
      return false;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        checking: false,
        error: error instanceof Error ? error.message : "Failed to check for updates",
      }));
      return false;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    try {
      // Re-check if we don't have a cached update
      if (!updateRef.current?.available) {
        const newUpdate = await check();
        if (!newUpdate?.available) {
          throw new Error("No update available");
        }
        updateRef.current = newUpdate;
      }

      setState((prev) => ({
        ...prev,
        downloading: true,
        error: null,
        downloadProgress: { contentLength: 0, downloaded: 0, percentage: 0 },
      }));

      let contentLength = 0;
      let downloaded = 0;

      await updateRef.current.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setState((prev) => ({
              ...prev,
              downloadProgress: { contentLength, downloaded: 0, percentage: 0 },
            }));
            break;
          case "Progress": {
            downloaded += event.data.chunkLength;
            const percentage =
              contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0;
            setState((prev) => ({
              ...prev,
              downloadProgress: { contentLength, downloaded, percentage },
            }));
            break;
          }
          case "Finished":
            setState((prev) => ({
              ...prev,
              downloading: false,
              installing: true,
              downloadProgress: { contentLength, downloaded: contentLength, percentage: 100 },
            }));
            break;
        }
      });

      // Relaunch the app to apply the update
      await relaunch();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        downloading: false,
        installing: false,
        downloadProgress: null,
        error: error instanceof Error ? error.message : "Failed to install update",
      }));
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      available: false,
      updateInfo: null,
      error: null,
      downloadProgress: null,
    }));
    updateRef.current = null;
  }, []);

  // Check for updates on mount if enabled
  useEffect(() => {
    if (checkOnMount) {
      checkForUpdates();
    }
  }, [checkOnMount, checkForUpdates]);

  return {
    ...state,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
  };
};
