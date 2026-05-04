export interface RecentFile {
  path: string;
  name: string;
  lastAccessed: string; // ISO timestamp
  accessCount: number;
  frecencyScore: number;
  workspacePath?: string | null;
  external?: boolean;
}

export interface RecentFileMetadata {
  workspacePath?: string | null;
  external?: boolean;
}

interface RecentFilesState {
  recentFiles: RecentFile[];
  maxRecentFiles: number;
}

interface RecentFilesActions {
  addOrUpdateRecentFile: (path: string, name: string, metadata?: RecentFileMetadata) => void;
  getRecentFilesOrderedByFrecency: () => RecentFile[];
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;
  pruneOldFiles: () => void;
}

export type RecentFilesStore = RecentFilesState & RecentFilesActions;
