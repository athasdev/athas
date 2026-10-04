export type ProjectRuleSource = "user" | "agents" | "claude" | "cursor" | "athas";

export interface ProjectRule {
  source: ProjectRuleSource;
  /** Path relative to the project root; absent for user rules. */
  path?: string;
  description?: string;
  /** Rules without globs or a description apply to every request. */
  alwaysApply: boolean;
  globs: string[];
  /** Directory the rule is scoped to, relative to the project root, for nested AGENTS.md files. */
  scope?: string;
  content: string;
}

export interface LoadedProjectRules {
  /** Rules included in the prompt, in the order they appear. */
  rules: ProjectRule[];
  /** Rules the model can read on request because their description matched no attached file. */
  available: ProjectRule[];
  /** The prompt section, or an empty string when there are no rules. */
  text: string;
  tokens: number;
  truncated: boolean;
}

export interface ProjectRuleDirectoryEntry {
  isSymlink?: boolean;
  name: string;
  path: string;
  isDir: boolean;
}

/** How rules are read; the default uses the workspace resource provider (local, SSH or WSL). */
export interface ProjectRuleReader {
  readDirectory(path: string): Promise<ProjectRuleDirectoryEntry[]>;
  readText(path: string): Promise<string>;
}
