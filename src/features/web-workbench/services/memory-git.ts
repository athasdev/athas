import type {
  FileStatus,
  GitBlame,
  GitBlameHunk,
  GitCommit,
  GitDiffLine,
  GitDiffStat,
  GitDiff_Serialize,
  GitFile,
  GitStatus,
} from "@/bindings/commands";
import type { MemoryFileSystem } from "@/features/web-workbench/services/memory-file-system";

/**
 * A small Git repository over the in-memory project: a HEAD snapshot, an index and the working
 * tree in `MemoryFileSystem`. It answers the status, staging, commit, log and diff commands the
 * workbench's Git views use, so they behave as they would on a real checkout.
 */

type Snapshot = Map<string, string>;

export interface MemoryGitOptions {
  branch: string;
  branches?: string[];
  /** Contents at HEAD, relative to the repository root. */
  head: Record<string, string>;
  /** Paths whose staged content differs from HEAD; `null` stages a deletion. */
  staged?: Record<string, string | null>;
  commits?: GitCommit[];
  ahead?: number;
}

export function diffLines(oldText: string, newText: string): GitDiffLine[] {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];
  const rows = oldLines.length;
  const columns = newLines.length;
  const lengths = Array.from({ length: rows + 1 }, () =>
    Array.from({ length: columns + 1 }, () => 0),
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        oldLines[i] === newLines[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const result: GitDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows || j < columns) {
    if (i < rows && j < columns && oldLines[i] === newLines[j]) {
      result.push({
        line_type: "context",
        content: oldLines[i],
        old_line_number: i + 1,
        new_line_number: j + 1,
      });
      i += 1;
      j += 1;
    } else if (j < columns && (i >= rows || lengths[i][j + 1] >= lengths[i + 1][j])) {
      result.push({
        line_type: "added",
        content: newLines[j],
        old_line_number: null,
        new_line_number: j + 1,
      });
      j += 1;
    } else {
      result.push({
        line_type: "removed",
        content: oldLines[i],
        old_line_number: i + 1,
        new_line_number: null,
      });
      i += 1;
    }
  }
  return result;
}

function globToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/** The root `.gitignore`, matched per path segment: enough for the sample project's patterns. */
function ignoreMatcher(gitignore: string | null) {
  const patterns = (gitignore ?? "")
    .split("\n")
    .map((line) => line.trim().replace(/^\/|\/$/g, ""))
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    .map(globToRegExp);
  return (path: string) =>
    path.split("/").some((segment) => patterns.some((pattern) => pattern.test(segment)));
}

function shortHash(seed: string) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(5);
}

function changeKind(before: string | undefined, after: string | undefined): FileStatus | null {
  if (before === after) return null;
  if (before === undefined) return "added";
  if (after === undefined) return "deleted";
  return "modified";
}

export class MemoryGitRepository {
  private head: Snapshot;
  private index: Snapshot;
  private commits: GitCommit[];
  private branch: string;
  private branches: string[];
  private ahead: number;

  constructor(
    private readonly fs: MemoryFileSystem,
    readonly root: string,
    options: MemoryGitOptions,
  ) {
    this.head = new Map(Object.entries(options.head));
    this.index = new Map(this.head);
    for (const [path, content] of Object.entries(options.staged ?? {})) {
      if (content === null) this.index.delete(path);
      else this.index.set(path, content);
    }
    this.commits = [...(options.commits ?? [])];
    this.branch = options.branch;
    this.branches = options.branches ?? [options.branch];
    this.ahead = options.ahead ?? 0;
  }

  contains(path: unknown) {
    const value = String(path ?? "");
    return value === this.root || value.startsWith(`${this.root}/`);
  }

  private worktree(): Snapshot {
    return new Map(
      this.fs.listFiles(this.root).map((path) => [path, this.fs.readText(`${this.root}/${path}`)]),
    );
  }

  private relative(path: unknown) {
    const value = String(path ?? "");
    return value.startsWith(`${this.root}/`) ? value.slice(this.root.length + 1) : value;
  }

  status(): GitStatus {
    const worktree = this.worktree();
    const gitignore = `${this.root}/.gitignore`;
    const isIgnored = ignoreMatcher(this.fs.exists(gitignore) ? this.fs.readText(gitignore) : null);
    const paths = new Set([...this.head.keys(), ...this.index.keys(), ...worktree.keys()]);
    const files: GitFile[] = [];
    for (const path of [...paths].sort()) {
      const staged = changeKind(this.head.get(path), this.index.get(path));
      if (staged) files.push({ path, status: staged, staged: true });
      const unstaged = changeKind(this.index.get(path), worktree.get(path));
      if (unstaged) {
        const untracked = unstaged === "added" && !this.head.has(path);
        if (untracked && isIgnored(path)) continue;
        files.push({ path, status: untracked ? "untracked" : unstaged, staged: false });
      }
    }
    return { branch: this.branch, ahead: this.ahead, behind: 0, files };
  }

  add(path: unknown) {
    const relative = this.relative(path);
    const absolute = `${this.root}/${relative}`;
    if (this.fs.exists(absolute)) this.index.set(relative, this.fs.readText(absolute));
    else this.index.delete(relative);
  }

  addAll() {
    for (const file of this.status().files) {
      if (!file.staged) this.add(file.path);
    }
  }

  reset(path: unknown) {
    const relative = this.relative(path);
    const content = this.head.get(relative);
    if (content === undefined) this.index.delete(relative);
    else this.index.set(relative, content);
  }

  resetAll() {
    this.index = new Map(this.head);
  }

  discard(path: unknown) {
    const relative = this.relative(path);
    const absolute = `${this.root}/${relative}`;
    const content = this.index.get(relative);
    if (content === undefined) {
      if (this.fs.exists(absolute)) this.fs.remove(absolute);
    } else {
      this.fs.writeText(absolute, content);
    }
  }

  discardAll() {
    for (const file of this.status().files) {
      if (!file.staged) this.discard(file.path);
    }
  }

  commit(message: string) {
    const [subject, ...rest] = message.trim().split("\n");
    if (!subject) throw new Error("Aborting commit due to empty commit message.");
    const changed = this.status().files.some((file) => file.staged);
    if (!changed) throw new Error("Nothing to commit.");
    this.head = new Map(this.index);
    this.commits.unshift({
      hash: shortHash(`${message}${Date.now()}${this.commits.length}`),
      message: subject,
      description: rest.join("\n").trim() || null,
      author: "You",
      email: "you@example.com",
      date: new Date().toISOString(),
    });
    this.ahead += 1;
  }

  log(limit?: number | null, skip?: number | null) {
    const start = skip ?? 0;
    return this.commits.slice(start, limit ? start + limit : undefined);
  }

  currentBranch() {
    return this.branch;
  }

  listBranches() {
    return [...this.branches];
  }

  createBranch(name: string) {
    if (this.branches.includes(name)) throw new Error(`A branch named '${name}' already exists.`);
    this.branches.push(name);
  }

  checkout(name: string) {
    if (!this.branches.includes(name)) throw new Error(`Unknown branch: ${name}`);
    this.branch = name;
    return { success: true, hasChanges: false, message: `Switched to branch '${name}'` };
  }

  diff(path: unknown, staged: boolean, workingContent?: string): GitDiff_Serialize {
    const relative = this.relative(path);
    const absolute = `${this.root}/${relative}`;
    const before = staged ? this.head.get(relative) : this.index.get(relative);
    const after = staged
      ? this.index.get(relative)
      : (workingContent ?? (this.fs.exists(absolute) ? this.fs.readText(absolute) : undefined));
    const lines = diffLines(before ?? "", after ?? "");
    return {
      file_path: relative,
      old_path: before === undefined ? null : relative,
      new_path: after === undefined ? null : relative,
      is_new: before === undefined,
      is_deleted: after === undefined,
      is_renamed: false,
      is_binary: false,
      is_image: false,
      old_blob_base64: null,
      new_blob_base64: null,
      lines,
      additions: lines.filter((line) => line.line_type === "added").length,
      deletions: lines.filter((line) => line.line_type === "removed").length,
    };
  }

  diffStats(): GitDiffStat[] {
    return this.status().files.map((file) => {
      const diff = this.diff(file.path, file.staged);
      return {
        file_path: file.path,
        staged: file.staged,
        additions: diff.additions ?? 0,
        deletions: diff.deletions ?? 0,
      };
    });
  }

  /**
   * Lines that match HEAD belong to the latest commit, the rest are not committed yet. The
   * sample history is too short for per-line attribution to tell anything more.
   */
  blame(path: unknown, content?: string | null): GitBlame {
    const relative = this.relative(path);
    const absolute = `${this.root}/${relative}`;
    const current = content ?? (this.fs.exists(absolute) ? this.fs.readText(absolute) : "");
    const latest = this.commits[0];
    const committed = this.head.get(relative);
    const hunks: GitBlameHunk[] = [];
    if (committed !== undefined && latest) {
      for (const line of diffLines(committed, current)) {
        if (line.line_type === "removed" || line.new_line_number === null) continue;
        const commitIndex = line.line_type === "context" ? 0 : null;
        const previous = hunks[hunks.length - 1];
        if (previous && previous.commit_index === commitIndex) previous.total_lines += 1;
        else
          hunks.push({
            line_number: line.new_line_number,
            total_lines: 1,
            commit_index: commitIndex,
          });
      }
    }
    return {
      file_path: relative,
      commits: latest
        ? [
            {
              hash: latest.hash,
              author: latest.author,
              email: latest.email,
              time: Math.floor(Date.parse(latest.date) / 1000),
              message: latest.message,
            },
          ]
        : [],
      hunks,
    };
  }

  fileAtHead(path: unknown) {
    const content = this.head.get(this.relative(path));
    if (content === undefined) throw new Error(`Path '${this.relative(path)}' is not in HEAD.`);
    return content;
  }
}
