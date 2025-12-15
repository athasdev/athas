import { useCallback, useEffect, useState } from "react";
import { useUpdater } from "./use-updater";

const UPDATE_CHECK_DELAY = 5000; // 5 seconds after app start
const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

export const useAutoUpdate = () => {
  const [showDialog, setShowDialog] = useState(false);
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

  // Show dialog when update is available
  useEffect(() => {
    if (available && updateInfo) {
      setShowDialog(true);
    }
  }, [available, updateInfo]);

  const handleDismiss = useCallback(() => {
    setShowDialog(false);
    dismissUpdate();
  }, [dismissUpdate]);

  const handleDownload = useCallback(async () => {
    await downloadAndInstall();
  }, [downloadAndInstall]);

  return {
    showDialog,
    updateInfo,
    downloadProgress,
    downloading,
    installing,
    error,
    checking,
    onDismiss: handleDismiss,
    onDownload: handleDownload,
    checkForUpdates,
  };
};
