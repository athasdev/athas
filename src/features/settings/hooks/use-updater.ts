import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AppUpdateMode, commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { prepareProjectTransitionWithUnsavedBuffers } from "@/features/file-system/services/workspace-project-transition";
import { recordUpdateCheckTelemetry } from "@/features/telemetry/services/telemetry";
import { openExternalUrl } from "@/utils/external-url";
import {
  clearUpdatePreferencesForNewVersion,
  notifyUpdateDismissed,
  remindAboutUpdateLater,
  shouldSuppressUpdate,
  skipUpdateVersion,
} from "../lib/update-preferences";
import { useSettingsStore } from "../stores/settings.store";
import { useWhatsNewStore } from "../stores/whats-new.store";

const DOWNLOAD_PAGE_URL = "https://athas.dev/download";

let appUpdateMode: Promise<AppUpdateMode> | null = null;

function getAppUpdateMode() {
  appUpdateMode ??= commands.appUpdateMode().catch((): AppUpdateMode => "self");
  return appUpdateMode;
}

const UPDATE_CHANNEL_HEADER = "X-Athas-Update-Channel";

// The endpoint stays the same; the server picks the manifest from this header.
function checkForChannelUpdate() {
  const channel = useSettingsStore.getState().settings.updateChannel;
  return check({ headers: { [UPDATE_CHANNEL_HEADER]: channel } });
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
}

interface DownloadProgress {
  contentLength: number;
  downloaded: number;
  percentage: number;
}

interface UpdateState {
  updateMode: AppUpdateMode;
  available: boolean;
  checking: boolean;
  downloading: boolean;
  installing: boolean;
  error: string | null;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
}

interface CheckForUpdatesOptions {
  ignoreSuppression?: boolean;
}

function readRawUpdateText(update: Update, key: string): string | undefined {
  const value = update.rawJson?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toUpdateInfo(update: Update): UpdateInfo {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    body: update.body || readRawUpdateText(update, "notes"),
    date: update.date || readRawUpdateText(update, "pub_date"),
  };
}

export const useUpdater = (checkOnMount = true) => {
  const [state, setState] = useState<UpdateState>({
    updateMode: "self",
    available: false,
    checking: false,
    downloading: false,
    installing: false,
    error: null,
    updateInfo: null,
    downloadProgress: null,
  });

  const updateRef = useRef<Update | null>(null);
  const updateInfoRef = useRef<UpdateInfo | null>(null);

  const checkForUpdates = useCallback(async (options: CheckForUpdatesOptions = {}) => {
    try {
      const updateMode = await getAppUpdateMode();
      if (updateMode === "external") {
        return false;
      }

      setState((prev) => ({ ...prev, updateMode, checking: true, error: null }));

      const update = await checkForChannelUpdate();
      updateRef.current = update;
      const currentVersion = update?.currentVersion ?? "";

      if (update?.available) {
        const updateInfo = toUpdateInfo(update);

        clearUpdatePreferencesForNewVersion(updateInfo);

        if (!options.ignoreSuppression && shouldSuppressUpdate(updateInfo)) {
          updateRef.current = null;
          updateInfoRef.current = null;
          setState((prev) => ({
            ...prev,
            available: false,
            checking: false,
            updateInfo: null,
          }));
          void recordUpdateCheckTelemetry({
            status: "available",
            availableVersion: update.version,
            currentVersion,
          });
          return false;
        }

        updateInfoRef.current = updateInfo;
        setState((prev) => ({
          ...prev,
          available: true,
          checking: false,
          updateInfo,
        }));
        void recordUpdateCheckTelemetry({
          status: "available",
          availableVersion: update.version,
          currentVersion,
        });
        return true;
      }

      updateInfoRef.current = null;
      setState((prev) => ({
        ...prev,
        available: false,
        checking: false,
        updateInfo: null,
      }));
      void recordUpdateCheckTelemetry({
        status: "up_to_date",
        availableVersion: null,
        currentVersion,
      });
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to check for updates";
      const failedCurrentVersion = updateInfoRef.current?.currentVersion ?? "";
      updateInfoRef.current = null;
      setState((prev) => ({
        ...prev,
        checking: false,
        error: message,
      }));
      void recordUpdateCheckTelemetry({
        status: "failed",
        availableVersion: null,
        currentVersion: failedCurrentVersion,
        error: message,
      });
      return false;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    try {
      if ((await getAppUpdateMode()) === "notify") {
        await openExternalUrl(DOWNLOAD_PAGE_URL);
        return;
      }

      // Re-check if we don't have a cached update
      if (!updateRef.current?.available) {
        const newUpdate = await checkForChannelUpdate();
        if (!newUpdate?.available) {
          throw new Error("No update available");
        }
        updateRef.current = newUpdate;
        updateInfoRef.current = toUpdateInfo(newUpdate);
      }

      const canRestart = await prepareProjectTransitionWithUnsavedBuffers(
        "restarting to update",
        useBufferStore.getState().buffers,
      );

      if (!canRestart) {
        return;
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

      if (updateInfoRef.current) {
        useWhatsNewStore.getState().actions.queuePendingUpdate(updateInfoRef.current);
      }

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
    updateInfoRef.current = null;
  }, []);

  const downloadLater = useCallback(() => {
    dismissUpdate();
    notifyUpdateDismissed();
  }, [dismissUpdate]);

  const remindLater = useCallback(
    (delayMs?: number) => {
      const updateInfo = updateInfoRef.current;
      if (!updateInfo) {
        return;
      }

      remindAboutUpdateLater(updateInfo, Date.now(), delayMs);
      dismissUpdate();
    },
    [dismissUpdate],
  );

  const skipVersion = useCallback(() => {
    const updateInfo = updateInfoRef.current;
    if (!updateInfo) {
      return;
    }

    skipUpdateVersion(updateInfo);
    dismissUpdate();
  }, [dismissUpdate]);

  const viewReleaseNotes = useCallback(() => {
    const updateInfo = updateInfoRef.current;
    if (!updateInfo) {
      return;
    }

    void useWhatsNewStore.getState().actions.openInfo({
      version: updateInfo.version,
      previousVersion: updateInfo.currentVersion,
      body: updateInfo.body,
      date: updateInfo.date,
    });
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
    downloadLater,
    remindLater,
    skipVersion,
    viewReleaseNotes,
  };
};
