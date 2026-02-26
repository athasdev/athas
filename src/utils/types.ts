// Shared types for AI chat utilities

export interface ContextInfo {
  activeBuffer?: {
    id: string;
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
    isSQLite: boolean;
    isActive: boolean;
    isWebViewer?: boolean;
    webViewerUrl?: string;
    webViewerContent?: string; // Fetched web page content
  };
  openBuffers?: Array<{
    id: string;
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
    isSQLite: boolean;
    isActive: boolean;
    isWebViewer?: boolean;
    webViewerUrl?: string;
  }>;
  selectedFiles?: string[];
  selectedProjectFiles?: string[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
  agentId?: string;
}
