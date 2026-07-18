export interface IconThemeDefinition {
  id: string;
  name: string;
  description: string;
  getFileIcon: (
    fileName: string,
    isDir: boolean,
    isExpanded?: boolean,
    isSymlink?: boolean,
  ) => IconResult;
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
