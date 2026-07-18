import { useEffect, useMemo, useRef, useState } from "react";
import { fffScanStatus } from "@/features/file-search/lib/file-search-api";
import { getNativeWorkspaceRootPaths } from "@/features/file-search/utils/file-search-paths";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileItem } from "../types/quick-open.types";
import { shouldIgnoreFile } from "../utils/file-filtering";

export const useFileLoader = (isVisible: boolean) => {
  const getAllProjectFiles = useFileSystemStore((state) => state.getAllProjectFiles);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const workspaceFolders = useFileSystemStore((state) => state.workspaceFolders);
  const nativeRootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );
  const workspaceKey = JSON.stringify([
    rootFolderPath,
    workspaceFolders.map((folder) => folder.path),
  ]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const loadedForRootRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    const isAlreadyLoaded = loadedForRootRef.current === workspaceKey;
    if (isAlreadyLoaded && files.length > 0) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

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

        if (cancelled) return;
        loadedForRootRef.current = workspaceKey;
        setFiles(filteredFiles);

        if (nativeRootPaths.length > 0) {
          const status = await fffScanStatus(nativeRootPaths);
          if (cancelled) return;
          setIsIndexing(status.is_scanning);
          if (status.is_scanning) {
            pollTimer = setTimeout(loadFiles, 150);
          }
        }
      } catch (error) {
        console.error("Failed to load project files:", error);
      } finally {
        setIsLoadingFiles(false);
        if (nativeRootPaths.length === 0) {
          setIsIndexing(false);
        }
      }
    };

    void loadFiles();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [getAllProjectFiles, isVisible, nativeRootPaths, workspaceKey]);

  return { files, isLoadingFiles, isIndexing, rootFolderPath };
};
