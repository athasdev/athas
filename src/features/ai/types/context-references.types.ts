import type { Diagnostic } from "@/features/diagnostics/types/diagnostics.types";
import type { GitDiff, GitStatus } from "@/features/git/types/git.types";
import type { AIMessage } from "./messages.types";

export type GitDiffScope = "working" | "staged";

/** Context the composer attaches that is not a single file. */
export type ContextReference =
  | { kind: "folder"; path: string }
  | { kind: "gitDiff"; scope: GitDiffScope }
  | { kind: "problems" }
  | { kind: "chat"; chatId: string; title: string };

export interface ResolvedContextReference {
  /** The serialized reference, so attachments and prompt sections line up. */
  id: string;
  label: string;
  content: string;
  truncated: boolean;
}

export interface ContextReferenceEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface ContextReferenceSources {
  readDirectory(path: string): Promise<ContextReferenceEntry[]>;
  readText(path: string): Promise<string>;
  getGitStatus(repoPath: string): Promise<GitStatus | null>;
  getFileDiff(repoPath: string, filePath: string, staged: boolean): Promise<GitDiff | null>;
  getDiagnostics(): Diagnostic[];
  /** The chat's messages as history, or null when the chat no longer exists. */
  loadChatHistory(chatId: string): Promise<AIMessage[] | null>;
}
