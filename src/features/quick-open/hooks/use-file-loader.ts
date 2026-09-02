import { useEffect, useMemo, useRef, useState } from "react";
import {
  type FffIndexedFile,
  fffListFiles,
  fffScanStatus,
} from "@/features/file-search/lib/file-search-api";
import type { FileItem } from "@/features/file-search/types/file-search.types";
import { shouldIgnoreSearchFile } from "@/features/file-search/utils/file-search-filtering";
import { getNativeWorkspaceRootPaths } from "@/features/file-search/utils/file-search-paths";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";

const toQuickOpenFiles = (files: readonly Pick<FffIndexedFile, "name" | "path">[]): FileItem[] =>
  files
    .filter((file) => !shouldIgnoreSearchFile(file.path))
    .map((file) => ({
      name: file.name,
      path: file.path,
      isDir: false,
    }));

function startPolling(callback: () => void, interval: number) {
  const intervalId = setInterval(callback, interval);
  return () => clearInterval(intervalId);
}

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
    let pollInFlight = false;

    const pollNativeIndex = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const status = await fffScanStatus(nativeRootPaths);
        if (cancelled) return;

        const indexedFiles = await fffListFiles(nativeRootPaths);
        if (cancelled) return;
        setFiles(toQuickOpenFiles(indexedFiles));
        setIsIndexing(status.is_scanning);

        if (!status.is_scanning) stopPolling();
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to read project index:", error);
        setIsIndexing(false);
      } finally {
        pollInFlight = false;
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

    const stopPolling =
      nativeRootPaths.length > 0 ? startPolling(() => void pollNativeIndex(), 150) : () => {};

    const cleanup = () => {
      cancelled = true;
      stopPolling();
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
