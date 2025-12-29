import type { FileEntry } from "@/features/file-system/types/app";
import type { GitFile } from "@/features/version-control/git/types/git";

export interface FileTreeProps {
  files: FileEntry[];
  activePath?: string;
  updateActivePath?: (path: string) => void;
  rootFolderPath?: string;
  onFileSelect: (path: string, isDir: boolean) => void;
  onFileOpen?: (path: string, isDir: boolean) => void;
  onCreateNewFileInDirectory: (directoryPath: string, fileName: string) => void;
  onCreateNewFolderInDirectory?: (directoryPath: string, folderName: string) => void;
  onDeletePath?: (path: string, isDir: boolean) => void;
  onGenerateImage?: (directoryPath: string) => void;
  onUpdateFiles?: (files: FileEntry[]) => void;
  onCopyPath?: (path: string) => void;
  onCutPath?: (path: string) => void;
  onRenamePath?: (path: string, newName?: string) => void;
  onDuplicatePath?: (path: string) => void;
  onRefreshDirectory?: (path: string) => void;
  onRevealInFinder?: (path: string) => void;
  onUploadFile?: (directoryPath: string) => void;
  onFileMove?: (oldPath: string, newPath: string) => void;
}

export interface FileTreeItemProps {
  file: FileEntry;
  depth: number;
  activePath?: string;
  dragOverPath: string | null;
  isDragging: boolean;
  deepestStickyFolder: string | null;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  onMouseDown: (e: React.MouseEvent, file: FileEntry) => void;
  onMouseMove: (e: React.MouseEvent, file: FileEntry) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onDoubleClick: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onKeyDown: (e: React.KeyboardEvent, file: FileEntry) => void;
  onBlur: (file: FileEntry) => void;
  getGitStatusColor: (file: FileEntry) => string;
  renderChildren?: (children: FileEntry[], depth: number) => React.ReactNode;
}

export type GitStatusColorGetter = (file: FileEntry) => string;

export interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

export type { FileEntry, GitFile };
