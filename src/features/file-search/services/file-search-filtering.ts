import { getBaseName, normalizePath } from "@/utils/path-helpers";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".cache",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".vscode",
  ".idea",
  "__pycache__",
  ".pytest_cache",
  "target",
  "out",
  ".DS_Store",
]);

const IGNORED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".gitignore",
  ".gitattributes",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
]);

const IGNORED_EXTENSIONS = new Set([".map", ".log", ".lock", ".min.js", ".min.css"]);

export function shouldIgnoreSearchEntry(name: string, isDirectory: boolean): boolean {
  if (isDirectory) return IGNORED_DIRECTORIES.has(name);
  if (IGNORED_FILES.has(name)) return true;

  for (const extension of IGNORED_EXTENSIONS) {
    if (name.endsWith(extension)) return true;
  }
  return false;
}

export function shouldIgnoreSearchFile(filePath: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const parts = normalizedPath.split("/");
  const fileName = getBaseName(normalizedPath, "");

  for (const part of parts.slice(0, -1)) {
    if (shouldIgnoreSearchEntry(part, true)) return true;
  }

  return shouldIgnoreSearchEntry(fileName, false);
}
