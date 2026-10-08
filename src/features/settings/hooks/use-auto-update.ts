import { useCallback, useEffect, useState } from "react";
import { onAppEvent } from "@/utils/app-events";
import { shouldSuppressUpdate } from "../lib/update-preferences";
import { useUpdater } from "./use-updater";

const UPDATE_CHECK_DELAY = 5000; // 5 seconds after app start
const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

export const useAutoUpdate = () => {
  const [showUpdateIndicator, setShowUpdateIndicator] = useState(false);
  const {
    available,
    checking,
    downloading,
    installing,
    error,
    updateInfo,
    downloadProgress,
    checkForUpdates,
    downloadAndInstall,
    dismissUpdate,
    downloadLater,
    remindLater,
    skipVersion,
    viewReleaseNotes,
  } = useUpdater(false); // Don't check on mount, we'll do it with a delay

  // Check for updates after app starts (with delay)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkForUpdates();
    }, UPDATE_CHECK_DELAY);

    // Set up periodic check
    const intervalId = setInterval(() => {
      checkForUpdates();
    }, UPDATE_CHECK_INTERVAL);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [checkForUpdates]);

  // Show the footer update indicator when update is available
  useEffect(() => {
    if (available && updateInfo) {
      setShowUpdateIndicator(true);
    }
  }, [available, updateInfo]);

  useEffect(() => {
    const hideUpdate = () => {
      setShowUpdateIndicator(false);
      dismissUpdate();
    };

    const syncUpdatePreferences = () => {
      if (!updateInfo || !shouldSuppressUpdate(updateInfo)) {
        return;
      }

      hideUpdate();
    };

    const unsubscribeDismissed = onAppEvent("updater:dismissed", hideUpdate);
    const unsubscribePreferences = onAppEvent("updater:preferences-changed", syncUpdatePreferences);

    return () => {
      unsubscribeDismissed();
      unsubscribePreferences();
    };
  }, [dismissUpdate, updateInfo]);

  const handleDismiss = useCallback(() => {
    setShowUpdateIndicator(false);
    downloadLater();
  }, [downloadLater]);

  const handleDownload = useCallback(async () => {
    await downloadAndInstall();
  }, [downloadAndInstall]);

  const handleRemindLater = useCallback(() => {
    setShowUpdateIndicator(false);
    remindLater();
  }, [remindLater]);

  const handleSkipVersion = useCallback(() => {
    setShowUpdateIndicator(false);
    skipVersion();
  }, [skipVersion]);

  return {
    showUpdateIndicator,
    updateInfo,
    downloadProgress,
    downloading,
    installing,
    error,
    checking,
    onDismiss: handleDismiss,
    onDownload: handleDownload,
    onRemindLater: handleRemindLater,
    onSkipVersion: handleSkipVersion,
    onViewReleaseNotes: viewReleaseNotes,
    checkForUpdates,
  };
};
