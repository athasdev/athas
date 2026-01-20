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
  isPreview?: boolean; // Whether the tab is in preview mode (single-click open)
  language?: string; // File language for syntax highlighting and formatting
  isWebViewer?: boolean; // Web viewer tab
  webViewerUrl?: string; // URL for web viewer
  webViewerTitle?: string; // Page title for web viewer
  webViewerFavicon?: string; // Favicon URL for web viewer
  isPullRequest?: boolean; // GitHub PR view
  prNumber?: number; // PR number for GitHub PR view
  isTerminal?: boolean; // Terminal tab
  terminalSessionId?: string; // Terminal session ID
  terminalInitialCommand?: string; // Command to run on terminal start
  isAgent?: boolean; // AI agent tab
  agentSessionId?: string; // Agent session ID
}
