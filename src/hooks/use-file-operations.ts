import { useState, useCallback } from "react";
import { openFolder, readDirectory, writeFile, createDirectory, deletePath } from "../utils/platform";
import { FileEntry } from "../types/app";
import { getRootPath } from "../utils/file-utils";

interface UseFileOperationsProps {
  openBuffer: (
    path: string,
    name: string,
    content: string,
    isSQLite: boolean,
    isImage: boolean,
    isDiff: boolean,
    isVirtual: boolean,
  ) => void;
}

export const useFileOperations = ({ openBuffer }: UseFileOperationsProps) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [rootFolderPath, setRootFolderPath] = useState<string>("");
  const [filesVersion, setFilesVersion] = useState<number>(0);

  // Cache for project files to avoid unnecessary re-scanning
  const [projectFilesCache, setProjectFilesCache] = useState<{
    path: string;
    files: FileEntry[];
    timestamp: number;
  } | null>(null);

  // Get all files recursively from the project (for command palette)
  const getAllProjectFiles = useCallback(async (): Promise<FileEntry[]> => {
    if (!rootFolderPath) return [];

    // Check cache first (cache for 30 seconds)
    const now = Date.now();
    if (projectFilesCache &&
      projectFilesCache.path === rootFolderPath &&
      now - projectFilesCache.timestamp < 30000) {
      console.log(`📋 Using cached project files: ${projectFilesCache.files.length} files`);
      return projectFilesCache.files;
    }

    const allFiles: FileEntry[] = [];

    // Common directories and patterns to ignore for performance
    const IGNORE_PATTERNS = [
      // Dependencies
      'node_modules',
      'vendor',
      '.pnpm',
      '.yarn',

      // Version control
      '.git',
      '.svn',
      '.hg',

      // Build outputs
      'dist',
      'build',
      'out',
      'target',
      '.next',
      '.nuxt',

      // Cache/temp directories
      '.cache',
      'tmp',
      'temp',
      '.tmp',
      '.DS_Store',
      'Thumbs.db',

      // IDE/Editor files
      '.vscode',
      '.idea',
      '*.swp',
      '*.swo',
      '*~',

      // Logs
      'logs',
      '*.log',

      // OS generated files
      '.Spotlight-V100',
      '.Trashes',
      'ehthumbs.db',

      // Package manager locks (large files)
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'Cargo.lock',
    ];

    const IGNORE_FILE_EXTENSIONS = [
      // Binary files
      '.exe', '.dll', '.so', '.dylib',
      '.bin', '.obj', '.o', '.a',

      // Large media files
      '.mov', '.mp4', '.avi', '.mkv',
      '.wav', '.mp3', '.flac',
      '.psd', '.ai', '.sketch',

      // Archives
      '.zip', '.rar', '.7z', '.tar', '.gz',

      // Database files
      '.db', '.sqlite', '.sqlite3',
    ];

    const shouldIgnore = (name: string, isDir: boolean): boolean => {
      const lowerName = name.toLowerCase();

      // Check ignore patterns
      for (const pattern of IGNORE_PATTERNS) {
        if (pattern.includes('*')) {
          // Simple glob pattern matching
          const regexPattern = pattern.replace(/\*/g, '.*');
          if (new RegExp(`^${regexPattern}$`).test(lowerName)) {
            return true;
          }
        } else if (lowerName === pattern.toLowerCase()) {
          return true;
        }
      }

      // Check file extensions (only for files, not directories)
      if (!isDir) {
        const extension = name.substring(name.lastIndexOf('.')).toLowerCase();
        if (IGNORE_FILE_EXTENSIONS.includes(extension)) {
          return true;
        }
      }

      // Skip hidden files/folders (starting with .) except important ones
      if (name.startsWith('.') && name !== '.env' && name !== '.gitignore' && name !== '.editorconfig') {
        return true;
      }

      return false;
    };

    const scanDirectory = async (directoryPath: string, depth: number = 0): Promise<void> => {
      // Prevent infinite recursion and very deep scanning
      if (depth > 10) {
        console.warn(`Max depth reached for ${directoryPath}`);
        return;
      }

      try {
        const entries = await readDirectory(directoryPath);
        let ignoredCount = 0;

        for (const entry of entries as any[]) {
          const name = entry.name || "Unknown";
          const isDir = entry.is_dir || false;

          // Skip ignored files/directories
          if (shouldIgnore(name, isDir)) {
            ignoredCount++;
            continue;
          }

          const fileEntry: FileEntry = {
            name,
            path: entry.path,
            isDir,
            expanded: false,
            children: undefined,
          };

          if (!fileEntry.isDir) {
            // Only add non-directory files to the list
            allFiles.push(fileEntry);
          } else {
            // Recursively scan subdirectories
            await scanDirectory(fileEntry.path, depth + 1);
          }

          // Yield control much less frequently to improve performance
          if (allFiles.length % 500 === 0) {
            // Use requestIdleCallback for better performance when available
            await new Promise(resolve => {
              if ('requestIdleCallback' in window) {
                requestIdleCallback(resolve, { timeout: 16 });
              } else {
                requestAnimationFrame(resolve);
              }
            });
          }
        }

        // Log ignored items for very verbose debugging (only at root level)
        if (depth === 0 && ignoredCount > 0) {
          console.log(`🚫 Ignored ${ignoredCount} items in root directory for performance`);
        }
      } catch (error) {
        console.error(`Error scanning directory ${directoryPath}:`, error);
      }
    };

    console.log(`🔍 Starting project file scan for: ${rootFolderPath}`);
    const startTime = Date.now();

    await scanDirectory(rootFolderPath);

    const endTime = Date.now();
    console.log(`✅ File scan completed: ${allFiles.length} files found in ${endTime - startTime}ms`);

    // Cache the results
    setProjectFilesCache({
      path: rootFolderPath,
      files: allFiles,
      timestamp: now,
    });

    return allFiles;
  }, [rootFolderPath, projectFilesCache]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await openFolder();

      if (selected) {
        // For both web and Tauri, we can now just read the directory
        const path = typeof selected === "string" ? selected : "";

        // Store the root folder path
        setRootFolderPath(path);

        // Clear the cache when changing folders
        setProjectFilesCache(null);

        const entries = await readDirectory(path);
        const fileTree = (entries as any[]).map((entry: any) => ({
          name: entry.name || "Unknown",
          path:
            entry.path ||
            (typeof selected === "string"
              ? `${selected}/${entry.name}`
              : entry.name),
          isDir: entry.is_dir || false,
          expanded: false,
          children: undefined,
        }));
        setFiles(fileTree);
      }
    } catch (error) {
      console.error("Error opening folder:", error);
    }
  }, []);

  // Function to invalidate the project files cache
  const invalidateProjectFilesCache = useCallback(() => {
    console.log("🗑️ Invalidating project files cache");
    setProjectFilesCache(null);
  }, []);

  const handleFolderToggle = useCallback(
    async (folderPath: string) => {
      const updateFiles = async (items: FileEntry[]): Promise<FileEntry[]> => {
        return Promise.all(
          items.map(async (item) => {
            if (item.path === folderPath && item.isDir) {
              if (!item.expanded) {
                // Expand folder - load children
                try {
                  const entries = await readDirectory(item.path);
                  const children = (entries as any[]).map((entry: any) => {
                    return {
                      name: entry.name || "Unknown",
                      path: entry.path,
                      isDir: entry.is_dir || false,
                      expanded: false,
                      children: undefined,
                    };
                  });
                  return { ...item, expanded: true, children };
                } catch (error) {
                  console.error("Error reading directory:", error);
                  return { ...item, expanded: true, children: [] };
                }
              } else {
                // Collapse folder
                return { ...item, expanded: false };
              }
            } else if (item.children) {
              // Recursively update children
              const updatedChildren = await updateFiles(item.children);
              return { ...item, children: updatedChildren };
            }
            return item;
          }),
        );
      };

      const updatedFiles = await updateFiles(files);
      setFiles(updatedFiles);
    },
    [files],
  );

  const refreshDirectory = useCallback(
    async (directoryPath: string) => {
      console.log("=== refreshDirectory called ===");
      console.log("Directory path to refresh:", directoryPath || "(empty string)");
      console.log("Root folder path:", rootFolderPath || "(not set)");
      
      // Normalize paths by removing trailing slashes for comparison
      const normalizedDirPath = directoryPath?.replace(/\/$/, '') || '';
      const normalizedRootPath = rootFolderPath?.replace(/\/$/, '') || '';
      
      // Check if we're refreshing the root directory
      if (normalizedDirPath === normalizedRootPath || (!normalizedDirPath && normalizedRootPath)) {
        console.log(">>> Executing ROOT DIRECTORY refresh");
        try {
          const entries = await readDirectory(rootFolderPath || directoryPath || ".");
          console.log(`    Found ${entries.length} entries in root`);
          // Use functional update to avoid stale closure
          setFiles(currentFiles => {
            console.log("Current files in functional update:", currentFiles.length);
            const newFiles = entries.map((entry: any) => {
              const existingFile = currentFiles.find(f => f.path === entry.path);
              const fileEntry: FileEntry = {
                name: entry.name || "Unknown",
                path: entry.path,
                isDir: entry.is_dir || false,
                expanded: existingFile?.expanded || false,
                children: existingFile?.expanded ? existingFile.children : undefined,
              };
              return fileEntry;
            });
            console.log(`    Setting ${newFiles.length} files in state`);
            console.log("    New root files:", newFiles.map(f => ({ path: f.path, isDir: f.isDir })));
            return newFiles;
          });
          setFilesVersion(v => v + 1); // Increment version to force re-render
          console.log(">>> Root directory refresh complete - state updated");
          return;
        } catch (error) {
          console.error("Error refreshing root directory:", error);
          return;
        }
      }
      
      console.log(`Looking for directory with path: "${directoryPath}"`);
      
      // Read the directory contents first
      let directoryEntries: any[] = [];
      const targetDir = await (async () => {
        // Find which directory to refresh by traversing current state
        let found: { path: string, isExpanded: boolean } | null = null;
        
        setFiles(currentFiles => {
          const findDirectory = (items: FileEntry[]): void => {
            for (const item of items) {
              if (item.path === directoryPath && item.isDir) {
                found = { path: item.path, isExpanded: item.expanded || false };
                return;
              }
              if (item.children) {
                findDirectory(item.children);
              }
            }
          };
          findDirectory(currentFiles);
          return currentFiles; // Don't change state, just read
        });
        
        return found;
      })();
      
      if (targetDir) {
        console.log(`Found target directory: ${targetDir.path}, expanded: ${targetDir.isExpanded}`);
        try {
          directoryEntries = await readDirectory(directoryPath);
          console.log(`Read ${directoryEntries.length} entries from ${directoryPath}`);
          console.log("Directory entries:", directoryEntries.map((e: any) => e.name));
        } catch (error) {
          console.error(`Error reading directory ${directoryPath}:`, error);
          return;
        }
      } else {
        console.warn(`Target directory not found in current state: ${directoryPath}`);
        // Still try to read the directory - it might exist on disk
        try {
          directoryEntries = await readDirectory(directoryPath);
          console.log(`Read ${directoryEntries.length} entries from ${directoryPath} (directory not in state)`);
        } catch (error) {
          console.error(`Error reading directory ${directoryPath}:`, error);
          return;
        }
      }
      
      // Now update the state with the fresh directory contents
      setFiles(currentFiles => {
        console.log("Updating files with fresh directory contents");
        
        const updateFilesRecursive = (items: FileEntry[], level: number = 0): FileEntry[] => {
          return items.map(item => {
            if (item.path === directoryPath && item.isDir) {
              console.log(`>>> Found and updating directory: ${item.path} at level ${level}`);
              console.log(`    Directory expanded state: ${item.expanded}`);
              console.log(`    Current children: ${item.children?.length || 0}`);
              if (item.children) {
                console.log(`    Current children names:`, item.children.map(c => c.name));
              }
              console.log(`    New entries: ${directoryEntries.length}`);
              console.log(`    New entry names:`, directoryEntries.map((e: any) => e.name));
              
              const newChildren = directoryEntries.map((entry: any) => {
                const existingChild = item.children?.find(c => c.path === entry.path);
                return {
                  name: entry.name || "Unknown",
                  path: entry.path,
                  isDir: entry.is_dir || false,
                  expanded: existingChild?.expanded || false,
                  children: undefined,
                };
              });
              
              // IMPORTANT: If the directory is expanded, we MUST update its children
              // to show the new files immediately
              if (item.expanded) {
                console.log(`    Directory is expanded, updating with ${newChildren.length} children`);
                // Create a completely new object to ensure React detects the change
                return {
                  name: item.name,
                  path: item.path,
                  isDir: item.isDir,
                  expanded: item.expanded,
                  children: newChildren.map(child => ({ ...child })), // Deep clone children
                };
              } else {
                console.log(`    Directory is collapsed, keeping it collapsed`);
                return {
                  ...item,
                  children: undefined,
                };
              }
            } else if (item.children) {
              // Recursively update children
              const updatedChildren = updateFilesRecursive(item.children, level + 1);
              // Only create new object if children actually changed
              const changed = updatedChildren.some((child, idx) => child !== item.children![idx]);
              return changed ? { ...item, children: updatedChildren } : item;
            }
            return item;
          });
        };
        
        const newFiles = updateFilesRecursive(currentFiles);
        console.log("Files updated with new directory contents");
        return newFiles;
      });
      
      setFilesVersion(v => v + 1); // Force re-render
    },
    [rootFolderPath],  // Only rootFolderPath needed, files accessed via functional updates
  );

  const handleCreateNewFileInDirectory = useCallback(
    async (directoryPath: string) => {
      const fileName = prompt("Enter the name for the new file:");
      if (!fileName) return;

      try {
        const newFilePath = directoryPath
          ? `${directoryPath}/${fileName}`
          : fileName;

        // Create an empty file
        await writeFile(newFilePath, "");

        // Invalidate project files cache since we added a new file
        invalidateProjectFilesCache();

        // If it's the root directory, just refresh the entire file tree
        if (
          !directoryPath ||
          files.some(
            (f) => f.path.split("/").slice(0, -1).join("/") === directoryPath,
          )
        ) {
          // Refresh the root directory
          const entries = await readDirectory(directoryPath || ".");
          const updatedFileTree = (entries as any[]).map((entry: any) => ({
            name: entry.name || "Unknown",
            path:
              entry.path ||
              (directoryPath ? `${directoryPath}/${entry.name}` : entry.name),
            isDir: entry.is_dir || false,
            expanded: false,
            children: undefined,
          }));
          setFiles(updatedFileTree);
        } else {
          // Refresh the specific directory
          await refreshDirectory(directoryPath);
        }

        // Open the new file in a buffer
        openBuffer(newFilePath, fileName, "", false, false, false, false);
      } catch (error) {
        console.error("Error creating new file:", error);
        alert("Failed to create file");
      }
    },
    [files, openBuffer, refreshDirectory, invalidateProjectFilesCache],
  );

  const handleCreateNewFolderInDirectory = useCallback(
    async (directoryPath: string) => {
      const folderName = prompt("Enter the name for the new folder:");
      if (!folderName) return;

      try {
        const newFolderPath = directoryPath
          ? `${directoryPath}/${folderName}`
          : folderName;

        // Create the directory
        await createDirectory(newFolderPath);

        // Invalidate project files cache since we added a new folder
        invalidateProjectFilesCache();

        // If it's the root directory, just refresh the entire file tree
        if (
          !directoryPath ||
          files.some(
            (f) => f.path.split("/").slice(0, -1).join("/") === directoryPath,
          )
        ) {
          // Refresh the root directory
          const entries = await readDirectory(directoryPath || ".");
          const updatedFileTree = (entries as any[]).map((entry: any) => ({
            name: entry.name || "Unknown",
            path:
              entry.path ||
              (directoryPath ? `${directoryPath}/${entry.name}` : entry.name),
            isDir: entry.is_dir || false,
            expanded: false,
            children: undefined,
          }));
          setFiles(updatedFileTree);
        } else {
          // Refresh the specific directory
          await refreshDirectory(directoryPath);
        }
      } catch (error) {
        console.error("Error creating new folder:", error);
        alert("Failed to create folder");
      }
    },
    [files, refreshDirectory, invalidateProjectFilesCache],
  );

  const handleDeletePath = useCallback(
    async (targetPath: string, isDirectory: boolean) => {
      const itemType = isDirectory ? "folder" : "file";
      const confirmMessage = isDirectory
        ? `Are you sure you want to delete the folder "${targetPath.split("/").pop()}" and all its contents? This action cannot be undone.`
        : `Are you sure you want to delete the file "${targetPath.split("/").pop()}"? This action cannot be undone.`;

      if (!confirm(confirmMessage)) {
        return;
      }

      try {
        // Delete the file or directory
        await deletePath(targetPath);

        invalidateProjectFilesCache();

        const parentPath = targetPath.split("/").slice(0, -1).join("/");

        if (!parentPath) {
          // If deleting from root, refresh the entire file tree
          const entries = await readDirectory(".");
          const updatedFileTree = (entries as any[]).map((entry: any) => ({
            name: entry.name || "Unknown",
            path: entry.path || entry.name,
            isDir: entry.is_dir || false,
            expanded: false,
            children: undefined,
          }));
          setFiles(updatedFileTree);
        } else {
          await refreshDirectory(parentPath);
        }
      } catch (error) {
        console.error(`Error deleting ${itemType}:`, error);
        alert(`Failed to delete ${itemType}`);
      }
    },
    [files, refreshDirectory, invalidateProjectFilesCache],
  );

  const handleCreateNewFile = useCallback(async () => {
    if (files.length === 0) {
      alert("Please open a folder first");
      return;
    }

    const rootPath = getRootPath(files);
    await handleCreateNewFileInDirectory(rootPath);
  }, [files, handleCreateNewFileInDirectory]);

  const handleCollapseAllFolders = useCallback(() => {
    const collapseFiles = (items: FileEntry[]): FileEntry[] => {
      return items.map((item) => {
        if (item.isDir) {
          return {
            ...item,
            expanded: false,
            children: item.children ? collapseFiles(item.children) : undefined,
          };
        }
        return item;
      });
    };

    const updatedFiles = collapseFiles(files);
    setFiles(updatedFiles);
  }, [files]);

  // Function to open a folder directly by path (for recent folders)
  const handleOpenFolderByPath = useCallback(async (folderPath: string) => {
    try {
      setRootFolderPath(folderPath);
      setProjectFilesCache(null);

      const entries = await readDirectory(folderPath);
      const fileTree = (entries as any[]).map((entry: any) => ({
        name: entry.name || "Unknown",
        path: entry.path || `${folderPath}/${entry.name}`,
        isDir: entry.is_dir || false,
        expanded: false,
        children: undefined,
      }));
      setFiles(fileTree);
      return true;
    } catch (error) {
      console.error("Error opening folder by path:", error);
      return false;
    }
  }, []);

  return {
    files,
    filesVersion,
    setFiles,
    rootFolderPath,
    getAllProjectFiles,
    handleOpenFolder,
    handleOpenFolderByPath,
    handleFolderToggle,
    handleCreateNewFile,
    handleCreateNewFileInDirectory,
    handleCreateNewFolderInDirectory,
    handleDeletePath,
    refreshDirectory,
    handleCollapseAllFolders,
    invalidateProjectFilesCache,
  };
};
