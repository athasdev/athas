import type { FileSearchResult, SearchMatch } from "@/features/file-search/api/file-search-api";

interface SourceTask {
  filePath: string;
  content: string;
  pattern: string;
  flags: string;
}
export interface ContentSearchTask extends SourceTask {
  kind: "search";
  contextLines: number;
}
export interface SourceReplacementTask extends SourceTask {
  kind: "replace";
  replacement: string;
  useRegex: boolean;
  expectedMatches?: SearchMatch[];
  target?: { line: number; column: number; expectedLine?: string };
}
export interface ProviderIgnoreRule {
  directory: string;
  content: string;
  kind: "gitignore" | "ignore" | "exclude";
}
export interface FilterSearchEntriesTask {
  kind: "filter";
  filePath: string;
  entries: Array<{ path: string; isDir: boolean }>;
  rules: ProviderIgnoreRule[];
}
export type SearchTask = ContentSearchTask | SourceReplacementTask | FilterSearchEntriesTask;
export type SearchTaskResult =
  | FileSearchResult
  | null
  | { content: string; count: number }
  | number[];
export type TaskResult<T extends SearchTask> = T extends ContentSearchTask
  ? FileSearchResult | null
  : T extends FilterSearchEntriesTask
    ? number[]
    : { content: string; count: number };
export interface SearchWorkerRequest {
  id: number;
  task: SearchTask;
}
export type SearchWorkerResponse =
  | { id: number; result: SearchTaskResult; error?: never }
  | { id: number; error: string; result?: never };
