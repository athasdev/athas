export interface IconThemeDefinition {
  id: string;
  name: string;
  description: string;
  getFileIcon: (fileName: string, isDir: boolean, isExpanded?: boolean) => IconResult;
}

export interface IconResult {
  svg?: string;
  component?: React.ReactNode;
}
