export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
  expanded?: boolean;
  isEditing?: boolean;
  isNewItem?: boolean;
  ignored?: boolean;
  isRenaming?: boolean;
  isSymlink?: boolean;
  symlinkTarget?: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}
