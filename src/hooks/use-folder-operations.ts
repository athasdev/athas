import { useCallback } from "react";
import type { FileEntry } from "../types/app";

interface UseFolderOperationsProps {
  isRemoteWindow: boolean;
  remoteConnectionId: string | null;
  files: FileEntry[];
  setFiles: (files: FileEntry[]) => void;
  localHandleFolderToggle: (folderPath: string) => Promise<void>;
  localHandleCollapseAllFolders: () => void;
  handleRemoteFolderToggle: (
    folderPath: string,
    files: FileEntry[],
    setFiles: (files: FileEntry[]) => void,
  ) => Promise<void>;
  handleRemoteCollapseAllFolders: (
    files: FileEntry[],
    setFiles: (files: FileEntry[]) => void,
  ) => void;
}

export const useFolderOperations = ({
  isRemoteWindow,
  remoteConnectionId,
  files,
  setFiles,
  localHandleFolderToggle,
  localHandleCollapseAllFolders,
  handleRemoteFolderToggle,
  handleRemoteCollapseAllFolders,
}: UseFolderOperationsProps) => {
  // Unified folder toggle that works with both local and remote files
  const handleFolderToggle = useCallback(
    async (folderPath: string) => {
      if (isRemoteWindow && remoteConnectionId) {
        // Handle remote folder toggle
        await handleRemoteFolderToggle(folderPath, files, setFiles);
      } else {
        // Use local folder toggle
        await localHandleFolderToggle(folderPath);
      }
    },
    [
      isRemoteWindow,
      remoteConnectionId,
      files,
      setFiles,
      localHandleFolderToggle,
      handleRemoteFolderToggle,
    ],
  );

  // Unified collapse all folders that works for both local and remote
  const handleCollapseAllFolders = useCallback(() => {
    if (isRemoteWindow && remoteConnectionId) {
      // Handle remote collapse all
      handleRemoteCollapseAllFolders(files, setFiles);
    } else {
      // Use local collapse all
      localHandleCollapseAllFolders();
    }
  }, [
    isRemoteWindow,
    remoteConnectionId,
    files,
    setFiles,
    localHandleCollapseAllFolders,
    handleRemoteCollapseAllFolders,
  ]);

  return {
    handleFolderToggle,
    handleCollapseAllFolders,
  };
};
