export interface FileDiff {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified" | "renamed";
  lines?: string[];
}

export interface Commit {
  oid: string;
  messageHeadline: string;
  messageBody: string;
  authoredDate: string;
  url?: string;
  authors: { login: string; name: string; email: string }[];
}

export interface FilePatchData {
  path: string;
  oldPath?: string;
  status: FileDiff["status"];
  lines: string[];
}

export interface DiffSectionRef {
  start: number;
  end: number;
  oldPath: string;
  newPath: string;
}

export type DiffSectionIndex = Record<string, DiffSectionRef>;

export type TabType = "activity" | "files";
export type FileStatusFilter = "all" | "added" | "deleted" | "modified" | "renamed";
export type FilePatchState = {
  loading: boolean;
  error?: string;
  data?: FilePatchData;
};
