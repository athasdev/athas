import { useCallback, useEffect, useState } from "react";
import type { RecentFolder } from "../types/recent-folders";

export const useRecentFolders = () => {
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([]);

  // Load recent folders from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("athas-code-recent-folders");
    if (stored) {
      try {
        setRecentFolders(JSON.parse(stored));
      } catch (error) {
        console.error("Error loading recent folders:", error);
      }
    }
  }, []);

  // Save recent folders to localStorage
  const saveRecentFolders = useCallback((folders: RecentFolder[]) => {
    try {
      localStorage.setItem("athas-code-recent-folders", JSON.stringify(folders));
      setRecentFolders(folders);
    } catch (error) {
      console.error("Error saving recent folders:", error);
    }
  }, []);

  // Add a folder to recents
  const addToRecents = useCallback(
    (folderPath: string) => {
      const folderName = folderPath.split("/").pop() || folderPath;
      const now = new Date();
      const timeString = now.toLocaleString();

      const newFolder: RecentFolder = {
        name: folderName,
        path: folderPath,
        lastOpened: timeString,
      };

      const updatedRecents = [newFolder, ...recentFolders.filter(f => f.path !== folderPath)].slice(
        0,
        5,
      ); // Keep only 5 most recent

      saveRecentFolders(updatedRecents);
    },
    [recentFolders, saveRecentFolders],
  );

  return {
    recentFolders,
    addToRecents,
    saveRecentFolders,
  };
};
