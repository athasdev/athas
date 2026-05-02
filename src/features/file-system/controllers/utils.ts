import type { FileEntry } from "../types/app";
import { sortFileEntries } from "./file-tree-utils";

const OS_GENERATED_FILE_PATTERNS: string[] = [
  ".DS_Store",
  ".DS_Store?",
  "._*",
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".DocumentRevisions-V100",
  ".VolumeIcon.icns",
  ".com.apple.timemachine.donotpresent",
  ".AppleDB",
  ".AppleDesktop",
  "Network Trash Folder",
  ".TemporaryItems",
  ".Temporary Items",
  "Thumbs.db",
  "ehthumbs.db",
  "Desktop.ini",
  "$RECYCLE.BIN",
  "System Volume Information",
];

function matchesNamePattern(name: string, pattern: string, caseInsensitive = false): boolean {
  if (!pattern.includes("*")) {
    return caseInsensitive ? name.toLowerCase() === pattern.toLowerCase() : name === pattern;
  }

  const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const flags = caseInsensitive ? "i" : undefined;
  return new RegExp(`^${escapedPattern}$`, flags).test(name);
}

export const shouldHideFromFileTree = (name: string): boolean =>
  OS_GENERATED_FILE_PATTERNS.some((pattern) => matchesNamePattern(name, pattern, true));

// Common directories and patterns to ignore for project-wide scans.
export const IGNORE_PATTERNS: string[] = [
  // Version control
  ".git",
  ".svn",
  ".hg",
  ".bzr",

  // Dependencies and build artifacts
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  ".next",
  ".nuxt",
  ".vuepress",
  ".cache",
  ".temp",
  ".tmp",
  "coverage",
  ".nyc_output",

  // Package managers
  ".yarn",
  ".pnpm",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  ".npm",

  // IDE and editor directories
  ".vscode",
  ".idea",
  ".vs",
  "*.swp",
  "*.swo",
  "*~",

  // OS generated files
  ".DS_Store",
  "Thumbs.db",

  // Language specific
  "__pycache__",
  "*.pyc",
  ".pytest_cache",
  ".mypy_cache",
  "venv",
  "env",
  ".env.*",
  ".venv",

  // Rust
  "Cargo.lock",

  // Go
  "vendor",

  // Java
  "*.class",
  ".gradle",
  ".mvn",

  // Logs
  "*.log",
  "logs",

  // Temporary files
  "*.tmp",
  "*.temp",
  "*.bak",
  "*.swp",
  "*.swo",

  // Large media files that shouldn't be in command palette
  "*.mov",
  "*.mp4",
  "*.avi",
  "*.mkv",
  "*.webm",
  "*.flv",
];

const IGNORE_FILE_EXTENSIONS: string[] = [
  // Binary files
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".obj",
  ".o",
  ".a",
  ".lib",

  // Archive files
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",

  // Image files (large ones)
  ".psd",
  ".ai",
  ".sketch",

  // Video files
  ".mov",
  ".mp4",
  ".avi",
  ".mkv",
  ".webm",
  ".flv",

  // Audio files
  ".mp3",
  ".wav",
  ".flac",
  ".aac",

  // Database files
  ".db",
  // ".sqlite",
  // ".sqlite3",

  // Lock files
  ".lock",
];

export const shouldIgnore = (name: string, isDir: boolean): boolean => {
  const lowerName = name.toLowerCase();
  // Check ignore patterns
  for (const pattern of IGNORE_PATTERNS as string[]) {
    if (matchesNamePattern(lowerName, pattern.toLowerCase())) {
      return true;
    }
  }

  // Check file extensions (only for files, not directories)
  if (!isDir) {
    const extension = name.substring(name.lastIndexOf(".")).toLowerCase();
    if (IGNORE_FILE_EXTENSIONS.includes(extension)) {
      return true;
    }
  }

  return shouldHideFromFileTree(name);
};

// Helper function for directory content updates (used with Immer)
export function updateDirectoryContents(
  files: FileEntry[],
  dirPath: string,
  newEntries: any[],
  preserveStates: boolean = true,
): boolean {
  for (const item of files) {
    if (item.path === dirPath && item.isDir) {
      // Create a map of existing children to preserve their states
      const existingChildrenMap = new Map<string, FileEntry>();
      if (preserveStates && item.children) {
        item.children.forEach((child) => {
          existingChildrenMap.set(child.path, child);
        });
      }

      // Update children with new entries and sort them
      item.children = sortFileEntries(
        newEntries
          .filter((entry: any) => {
            const entryName = entry.name || "Unknown";
            return !shouldHideFromFileTree(entryName);
          })
          .map((entry: any) => {
            const existingChild = preserveStates ? existingChildrenMap.get(entry.path) : null;
            return {
              name: entry.name || "Unknown",
              path: entry.path,
              isDir: entry.is_dir || false,
              expanded: existingChild?.expanded || false,
              children: existingChild?.children || undefined,
            };
          }),
      );

      return true; // Directory was found and updated
    }

    // Recursively search in children
    if (
      item.children &&
      updateDirectoryContents(item.children, dirPath, newEntries, preserveStates)
    ) {
      return true;
    }
  }
  return false; // Directory not found
}
