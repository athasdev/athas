export interface RecentFolder {
  name: string;
  path: string;
  lastOpened: string;
  lastOpenedAt?: number;
  activeProjectTabId?: string;
  customIcon?: string;
  missing?: boolean;
  openInNewWindow?: boolean;
  pinned?: boolean;
  importSourceId?: string;
  importSourceName?: string;
}

export interface RecentFolderMetadata {
  activeProjectTabId?: string;
  customIcon?: string;
  lastOpenedAt?: number;
  missing?: boolean;
  openInNewWindow?: boolean;
  importSourceId?: string;
  importSourceName?: string;
}
