import type { CodeEditorRef } from "@/components/editor/code-editor";
import type { FileEntry } from "./app";

export interface FsState {
  files: FileEntry[];
  rootFolderPath?: string;
  filesVersion: number;
  isFileTreeLoading: boolean;

  // Remote connection state
  isRemoteWindow: boolean;
  remoteConnectionId?: string;
  remoteConnectionName?: string;

  // Cache for project files
  projectFilesCache?: {
    path: string;
    files: FileEntry[];
    timestamp: number;
  };
}

export interface FsActions {
  // Folder operations
  handleOpenFolder: () => Promise<boolean>;
  handleOpenFolderByPath: (path: string) => Promise<boolean>;
  // File operations
  handleFileSelect: (
    path: string,
    isDir: boolean,
    line?: number,
    column?: number,
    codeEditorRef?: React.RefObject<CodeEditorRef | null>,
  ) => Promise<void>;
  toggleFolder: (path: string) => Promise<void>;
  handleCreateNewFile: () => Promise<void>;
  handleCreateNewFileInDirectory: (
    dirPath: string,
    fileName?: string,
  ) => Promise<string | undefined>;
  handleCreateNewFolderInDirectory: (
    dirPath: string,
    folderName?: string,
  ) => Promise<string | undefined>;
  handleDeletePath: (targetPath: string, isDirectory: boolean) => Promise<void>;
  refreshDirectory: (directoryPath: string) => Promise<void>;
  handleCollapseAllFolders: () => Promise<void>;
  handleFileMove: (oldPath: string, newPath: string) => Promise<void>;
  handleRevealInFolder: (path: string) => Promise<void>;

  // Search operations
  getAllProjectFiles: () => Promise<FileEntry[]>;

  // CRUD operations
  createFile: (directoryPath: string, fileName: string) => Promise<string>;
  createDirectory: (parentPath: string, folderName: string) => Promise<string>;
  deleteFile: (path: string) => Promise<void>;

  // Setter methods
  setFiles: (newFiles: FileEntry[]) => void;
}
