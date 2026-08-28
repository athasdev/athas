export interface IconThemeDefinition {
  id: string;
  name: string;
  description: string;
  preview?: IconThemePreviewTarget;
  getFileIcon: (
    fileName: string,
    isDir: boolean,
    isExpanded?: boolean,
    isSymlink?: boolean,
  ) => IconResult;
}

export interface IconThemePreviewTarget {
  fileName: string;
  isDirectory: boolean;
}

export interface IconResult {
  svg?: string;
  url?: string;
  component?: React.ReactNode;
}

export interface IconThemeSource {
  extensionId: string;
  isBundled?: boolean;
}
