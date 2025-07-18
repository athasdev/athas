import { useEffect } from "react";
import {
  cleanupFileWatcherListener,
  initializeFileWatcherListener,
} from "../stores/file-watcher-store";

export function useFileWatcherEvents() {
  useEffect(() => {
    // Initialize file watcher event listeners
    initializeFileWatcherListener();

    // Cleanup on unmount
    return () => {
      cleanupFileWatcherListener();
    };
  }, []);
}
