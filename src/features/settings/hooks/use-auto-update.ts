import { useCallback, useEffect, useState } from "react";
import {
  shouldSuppressUpdate,
  UPDATE_DISMISSED_EVENT,
  UPDATE_PREFERENCES_CHANGED_EVENT,
} from "../lib/update-preferences";
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

    window.addEventListener(UPDATE_DISMISSED_EVENT, hideUpdate);
    window.addEventListener(UPDATE_PREFERENCES_CHANGED_EVENT, syncUpdatePreferences);

    return () => {
      window.removeEventListener(UPDATE_DISMISSED_EVENT, hideUpdate);
      window.removeEventListener(UPDATE_PREFERENCES_CHANGED_EVENT, syncUpdatePreferences);
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
