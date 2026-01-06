import { useEffect, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import type { FileItem } from "../types/command-bar";
import { shouldIgnoreFile } from "../utils/file-filtering";

export const useFileLoader = (isVisible: boolean) => {
  const getAllProjectFiles = useFileSystemStore((state) => state.getAllProjectFiles);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const commandBarFileLimit = useSettingsStore((state) => state.settings.commandBarFileLimit);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);

  useEffect(() => {
    if (!isVisible) return;

    const loadFiles = async () => {
      try {
        const wasEmpty = files.length === 0;

        if (wasEmpty) {
          setIsLoadingFiles(true);
          setIsIndexing(true);
        }

        const allFiles = await getAllProjectFiles();
        const filteredFiles = allFiles
          .filter((file) => !file.isDir && !shouldIgnoreFile(file.path))
          .map((file) => ({
            name: file.name,
            path: file.path,
            isDir: file.isDir,
          }));

        setFiles(filteredFiles);
      } catch (error) {
        console.error("Failed to load project files:", error);
      } finally {
        setIsLoadingFiles(false);
        setIsIndexing(false);
      }
    };

    loadFiles();
  }, [getAllProjectFiles, isVisible, commandBarFileLimit]);

  return { files, isLoadingFiles, isIndexing, rootFolderPath };
};
