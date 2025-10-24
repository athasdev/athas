// Patterns to ignore when showing files in command palette
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
  "target", // Rust
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

export const shouldIgnoreInCommandPalette = (name: string, isDirectory: boolean): boolean => {
  // Check if it's a directory that should be ignored
  if (isDirectory && IGNORED_DIRECTORIES.has(name)) {
    return true;
  }

  // Check if it's a file that should be ignored
  if (!isDirectory && IGNORED_FILES.has(name)) {
    return true;
  }

  // Check file extension
  if (!isDirectory) {
    const ext = name.substring(name.lastIndexOf("."));
    if (IGNORED_EXTENSIONS.has(ext)) {
      return true;
    }
  }

  return false;
};
