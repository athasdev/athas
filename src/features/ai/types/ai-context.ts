export interface ContextBuffer {
  id: string;
  path: string;
  name: string;
  type?: string;
  content?: string;
  savedContent?: string;
  isDirty?: boolean;
  isVirtual?: boolean;
  isActive?: boolean;
  isSQLite?: boolean;
  url?: string;
  webViewerUrl?: string;
  title?: string;
  favicon?: string;
  sourceFilePath?: string;
  language?: string;
  languageOverride?: string;
}

export interface ContextInfo {
  activeBuffer?: ContextBuffer & { webViewerContent?: string };
  openBuffers?: ContextBuffer[];
  selectedFiles?: string[];
  selectedProjectFiles?: string[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
  agentId?: string;
}
