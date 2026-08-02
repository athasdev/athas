import { useEffect, useMemo, useRef, useState } from "react";
import {
  type FffIndexedFile,
  fffListFiles,
  fffScanStatus,
} from "@/features/file-search/lib/file-search-api";
import { getNativeWorkspaceRootPaths } from "@/features/file-search/utils/file-search-paths";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FileItem } from "../types/quick-open.types";
import { shouldIgnoreFile } from "../utils/file-filtering";

const toQuickOpenFiles = (files: readonly Pick<FffIndexedFile, "name" | "path">[]): FileItem[] =>
  files
    .filter((file) => !shouldIgnoreFile(file.path))
    .map((file) => ({
      name: file.name,
      path: file.path,
      isDir: false,
    }));

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
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const pollNativeIndex = async () => {
      try {
        const status = await fffScanStatus(nativeRootPaths);
        if (cancelled) return;

        const indexedFiles = await fffListFiles(nativeRootPaths);
        if (cancelled) return;
        setFiles(toQuickOpenFiles(indexedFiles));
        setIsIndexing(status.is_scanning);

        if (status.is_scanning) {
          pollTimer = setTimeout(() => void pollNativeIndex(), 150);
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to read project index:", error);
        setIsIndexing(false);
      }
    };

    const loadFiles = async () => {
      if (loadedForRootRef.current !== workspaceKey) {
        setFiles([]);
      }
      setIsLoadingFiles(true);
      setIsIndexing(nativeRootPaths.length > 0);

      try {
        const allFiles = await getAllProjectFiles();
        if (cancelled) return;
        loadedForRootRef.current = workspaceKey;
        setFiles(toQuickOpenFiles(allFiles.filter((file) => !file.isDir)));

        if (nativeRootPaths.length > 0) {
          await pollNativeIndex();
        } else {
          setIsIndexing(false);
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load project files:", error);
        setIsIndexing(false);
      } finally {
        if (!cancelled) setIsLoadingFiles(false);
      }
    };

    const cleanup = () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };

    if (isAlreadyLoaded) {
      if (nativeRootPaths.length > 0) {
        void pollNativeIndex();
      }
      return cleanup;
    }

    void loadFiles();
    return cleanup;
  }, [getAllProjectFiles, isVisible, nativeRootPaths, workspaceKey]);

  return {
    files,
    hasLoadedFiles: loadedForRootRef.current === workspaceKey,
    isLoadingFiles,
    isIndexing,
    rootFolderPath,
  };
};
