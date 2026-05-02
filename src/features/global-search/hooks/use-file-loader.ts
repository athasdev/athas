import { useEffect, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { MAX_FILES_TO_PROCESS } from "../constants/limits";
import type { FileItem } from "../models/types";
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
        // Always show loading when opening
        setIsLoadingFiles(true);
        setIsIndexing(files.length === 0);

        const allFiles = await getAllProjectFiles();
        const filteredFiles = allFiles
          .slice(0, MAX_FILES_TO_PROCESS)
          .filter((file) => !file.isDir && !shouldIgnoreFile(file.path))
          .map((file) => ({
            name: file.name,
            path: file.path,
            isDir: file.isDir,
          }));

        loadedForRootRef.current = rootFolderPath;
        setFiles(filteredFiles);
        setIsLoadingFiles(false);

        // Keep showing indexing for a bit if we got results quickly (means it's cached)
        if (filteredFiles.length > 0 && isIndexing) {
          setIsIndexing(false);
        }
      } catch (error) {
        console.error("Failed to load project files:", error);
        setFiles([]);
        setIsLoadingFiles(false);
        setIsIndexing(false);
      }
    };

    loadFiles();
  }, [files.length, getAllProjectFiles, isVisible, rootFolderPath]);

  return { files, isLoadingFiles, isIndexing, rootFolderPath };
};
