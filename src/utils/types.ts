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
  };
  openBuffers?: Array<{
    id: string;
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
    isSQLite: boolean;
    isActive: boolean;
  }>;
  selectedFiles?: string[];
  selectedProjectFiles?: string[];
  projectRoot?: string;
  language?: string;
  providerId?: string;
}
