export interface Buffer {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean; // Has unsaved changes
  isSQLite: boolean;
  isImage: boolean;
  isDiff: boolean; // Diff view files
  isVirtual: boolean; // Virtual files aren't saved to disk
  isActive: boolean;
  isPinned?: boolean; // Whether the tab is pinned
  language?: string; // File language for syntax highlighting and formatting
}
