import { useEffect, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { FileItem } from "../types/quick-open";
import { shouldIgnoreFile } from "../utils/file-filtering";

export const useFileLoader = (isVisible: boolean) => {
  const getAllProjectFiles = useFileSystemStore((state) => state.getAllProjectFiles);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const loadedForRootRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isVisible) return;

    const isAlreadyLoaded = loadedForRootRef.current === rootFolderPath;
    if (isAlreadyLoaded && files.length > 0) return;

    const loadFiles = async () => {
      try {
        setIsLoadingFiles(true);
        setIsIndexing(true);

        const allFiles = await getAllProjectFiles();
        const filteredFiles = allFiles
          .filter((file) => !file.isDir && !shouldIgnoreFile(file.path))
          .map((file) => ({
            name: file.name,
            path: file.path,
            isDir: file.isDir,
          }));

        loadedForRootRef.current = rootFolderPath;
        setFiles(filteredFiles);
      } catch (error) {
        console.error("Failed to load project files:", error);
      } finally {
        setIsLoadingFiles(false);
        setIsIndexing(false);
      }
    };

    loadFiles();
  }, [getAllProjectFiles, isVisible, rootFolderPath]);

  return { files, isLoadingFiles, isIndexing, rootFolderPath };
};
