/**
 * The project the browser workbench edits. It lives only in memory: edits, new files, renames
 * and deletes work for the length of the visit and nothing is uploaded anywhere.
 */

export interface MemoryDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

export interface MemoryFileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: number;
}

export interface MemorySearchMatch {
  path: string;
  line: number;
  text: string;
}

const encoder = new TextEncoder();

export function normalizePath(path: unknown): string {
  const value = String(path ?? "");
  const withoutScheme = value.startsWith("file://") ? value.slice("file://".length) : value;
  const collapsed = withoutScheme.replace(/\/+/g, "/");
  return collapsed.replace(/\/+$/, "") || "/";
}

function parentOf(path: string) {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function ancestorsOf(path: string) {
  const result: string[] = [];
  let current = parentOf(path);
  while (current !== "/") {
    result.push(current);
    current = parentOf(current);
  }
  return result;
}

export class MemoryFileSystem {
  private readonly files = new Map<string, { content: string; mtime: number }>();
  private readonly directories = new Set<string>(["/"]);

  constructor(root: string, files: Record<string, string>, extraDirectories: string[] = []) {
    const rootPath = normalizePath(root);
    this.mkdir(rootPath);
    for (const directory of extraDirectories) this.mkdir(directory);
    for (const [path, content] of Object.entries(files)) {
      this.writeText(`${rootPath}/${path}`, content);
    }
  }

  exists(path: unknown) {
    const target = normalizePath(path);
    return this.files.has(target) || this.directories.has(target);
  }

  isDirectory(path: unknown) {
    return this.directories.has(normalizePath(path));
  }

  stat(path: unknown): MemoryFileStat {
    const target = normalizePath(path);
    const file = this.files.get(target);
    if (!file && !this.directories.has(target)) {
      throw new Error(`No such file or directory: ${target}`);
    }
    return {
      isFile: Boolean(file),
      isDirectory: !file,
      isSymlink: false,
      size: file ? encoder.encode(file.content).length : 0,
      mtime: file?.mtime ?? 0,
    };
  }

  readText(path: unknown) {
    const target = normalizePath(path);
    const file = this.files.get(target);
    if (!file) throw new Error(`No such file: ${target}`);
    return file.content;
  }

  writeText(path: unknown, content: string) {
    const target = normalizePath(path);
    if (this.directories.has(target)) throw new Error(`Is a directory: ${target}`);
    for (const directory of ancestorsOf(target)) this.directories.add(directory);
    this.files.set(target, { content, mtime: Date.now() });
  }

  mkdir(path: unknown) {
    const target = normalizePath(path);
    if (this.files.has(target)) throw new Error(`File exists: ${target}`);
    for (const directory of ancestorsOf(target)) this.directories.add(directory);
    this.directories.add(target);
  }

  remove(path: unknown) {
    const target = normalizePath(path);
    if (!this.exists(target)) throw new Error(`No such file or directory: ${target}`);
    const prefix = `${target}/`;
    this.files.delete(target);
    this.directories.delete(target);
    for (const file of this.files.keys()) if (file.startsWith(prefix)) this.files.delete(file);
    for (const directory of this.directories) {
      if (directory.startsWith(prefix)) this.directories.delete(directory);
    }
  }

  rename(from: unknown, to: unknown) {
    const source = normalizePath(from);
    const target = normalizePath(to);
    if (!this.exists(source)) throw new Error(`No such file or directory: ${source}`);
    if (this.exists(target)) throw new Error(`Already exists: ${target}`);
    const file = this.files.get(source);
    if (file) {
      this.files.delete(source);
      this.writeText(target, file.content);
      return;
    }
    const prefix = `${source}/`;
    this.mkdir(target);
    // Renamed entries are added while looping, so loop over a copy.
    for (const directory of Array.from(this.directories)) {
      if (directory.startsWith(prefix)) {
        this.directories.delete(directory);
        this.directories.add(`${target}/${directory.slice(prefix.length)}`);
      }
    }
    for (const [path, entry] of Array.from(this.files)) {
      if (path.startsWith(prefix)) {
        this.files.delete(path);
        this.files.set(`${target}/${path.slice(prefix.length)}`, entry);
      }
    }
    this.directories.delete(source);
  }

  list(path: unknown): MemoryDirEntry[] {
    const target = normalizePath(path);
    if (!this.directories.has(target)) throw new Error(`Not a directory: ${target}`);
    const prefix = target === "/" ? "/" : `${target}/`;
    const entries = new Map<string, boolean>();
    for (const directory of this.directories) {
      const rest = directory.slice(prefix.length);
      if (directory.startsWith(prefix) && rest && !rest.includes("/")) entries.set(rest, true);
    }
    for (const file of this.files.keys()) {
      const rest = file.slice(prefix.length);
      if (file.startsWith(prefix) && rest && !rest.includes("/")) entries.set(rest, false);
    }
    return [...entries.entries()]
      .sort(([a, aDir], [b, bDir]) => (aDir === bDir ? a.localeCompare(b) : aDir ? -1 : 1))
      .map(([name, isDirectory]) => ({
        name,
        isDirectory,
        isFile: !isDirectory,
        isSymlink: false,
      }));
  }

  /** Every file below `root`, relative to it, in path order. */
  listFiles(root: unknown): string[] {
    const prefix = `${normalizePath(root)}/`;
    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .sort((a, b) => a.localeCompare(b));
  }

  /** Lines below `root` that contain `query`, case-insensitively unless `caseSensitive`. */
  search(root: unknown, query: string, caseSensitive = false): MemorySearchMatch[] {
    if (!query) return [];
    const needle = caseSensitive ? query : query.toLowerCase();
    const rootPath = normalizePath(root);
    const matches: MemorySearchMatch[] = [];
    for (const path of this.listFiles(rootPath)) {
      const lines = this.readText(`${rootPath}/${path}`).split("\n");
      lines.forEach((text, index) => {
        const haystack = caseSensitive ? text : text.toLowerCase();
        if (haystack.includes(needle)) matches.push({ path, line: index + 1, text });
      });
    }
    return matches;
  }
}
