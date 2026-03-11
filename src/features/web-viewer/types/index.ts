export interface HistoryEntry {
  url: string;
  title: string;
  favicon: string;
  timestamp: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  favicon: string;
  createdAt: number;
}

export interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  category: "phone" | "tablet" | "desktop";
  userAgent?: string;
}

export interface WebViewerNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}
