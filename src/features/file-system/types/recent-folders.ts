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
}

export interface RecentFolderMetadata {
  activeProjectTabId?: string;
  customIcon?: string;
  lastOpenedAt?: number;
  missing?: boolean;
  openInNewWindow?: boolean;
}
