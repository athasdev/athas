export interface RecentFile {
  path: string;
  name: string;
  lastAccessed: string; // ISO timestamp
  accessCount: number;
  frecencyScore: number;
}

interface RecentFilesState {
  recentFiles: RecentFile[];
  maxRecentFiles: number;
}

interface RecentFilesActions {
  addOrUpdateRecentFile: (path: string, name: string) => void;
  getRecentFilesOrderedByFrecency: () => RecentFile[];
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;
  pruneOldFiles: () => void;
}

export type RecentFilesStore = RecentFilesState & RecentFilesActions;
