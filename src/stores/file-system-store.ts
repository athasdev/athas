import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { CodeEditorRef } from "../components/editor/code-editor";
import type { FileEntry } from "../types/app";
import { readDirectoryContents } from "../utils/file-operations";
import {
  addFileToTree,
  findFileInTree,
  removeFileFromTree,
  sortFileEntries,
  updateFileInTree,
} from "../utils/file-tree-utils";
import { getRootPath } from "../utils/file-utils";
import { readDirectory } from "../utils/platform";

interface FileSystemState {
  files: FileEntry[];
  rootFolderPath: string | undefined;
  filesVersion: number;
  isFileTreeLoading: boolean; // Kept for backward compatibility

  // Remote connection state
  isRemoteWindow: boolean;
  remoteConnectionId: string | null;
  remoteConnectionName: string | null;

  // Cache for project files
  projectFilesCache: {
    path: string;
    files: FileEntry[];
    timestamp: number;
  } | null;
}

export const useFileSystemStore = create(
  immer(
    combine(
      {
        files: [],
        rootFolderPath: undefined as string | undefined,
        filesVersion: 0,
        isFileTreeLoading: false,
        isRemoteWindow: false,
        remoteConnectionId: null,
        remoteConnectionName: null,
        projectFilesCache: null,
      } as FileSystemState,
      (set, get) => ({
        // These methods have been moved to file-system-actions.ts
        // Keeping them here for backward compatibility, but they just delegate
        handleOpenFolder: async () => {
          const { useFileSystemActions } = await import("./file-system-actions");
          return useFileSystemActions.getState().handleOpenFolder();
        },

        handleOpenFolderByPath: async (path: string) => {
          const { useFileSystemActions } = await import("./file-system-actions");
          return useFileSystemActions.getState().handleOpenFolderByPath(path);
        },

        loadFolderContents: async (path: string) => {
          const { useFileSystemActions } = await import("./file-system-actions");
          return useFileSystemActions.getState().handleOpenFolderByPath(path);
        },

        // File operations
        handleFileSelect: async (
          path: string,
          isDir: boolean,
          line?: number,
          column?: number,
          codeEditorRef?: React.RefObject<CodeEditorRef | null>,
        ) => {
          if (isDir) {
            const state = get();
            await (state as any).toggleFolder(path);
            return;
          }

          const { useFileSystemActions } = await import("./file-system-actions");
          return useFileSystemActions.getState().handleFileSelect(path, isDir, {
            line,
            column,
            codeEditorRef,
          });
        },

        toggleFolder: async (path: string) => {
          const { isRemoteWindow, remoteConnectionId } = get();

          if (isRemoteWindow && remoteConnectionId) {
            // TODO: Implement remote folder operations
            return;
          }

          const { useFileTreeStore } = await import("./file-tree-store");
          const folder = findFileInTree(get().files, path);

          if (!folder || !folder.isDir) return;

          if (!folder.expanded) {
            // Expand folder - load children
            try {
              const entries = await readDirectoryContents(folder.path);
              const updatedFiles = updateFileInTree(get().files, path, item => ({
                ...item,
                expanded: true,
                children: sortFileEntries(entries),
              }));

              set(state => {
                state.files = updatedFiles;
                state.filesVersion = state.filesVersion + 1;
              });

              useFileTreeStore.getState().toggleFolder(path);
            } catch (error) {
              console.error("Error reading directory:", error);
            }
          } else {
            // Collapse folder
            const updatedFiles = updateFileInTree(get().files, path, item => ({
              ...item,
              expanded: false,
            }));

            set(state => {
              state.files = updatedFiles;
              state.filesVersion = state.filesVersion + 1;
            });

            useFileTreeStore.getState().toggleFolder(path);
          }
        },

        handleRemoteFolderToggle: async (path: string) => {
          // TODO: Implement remote folder operations
          console.log("Remote folder toggle:", path);
        },

        handleCreateNewFile: async () => {
          const { rootFolderPath, files } = get();

          if (!rootFolderPath) {
            alert("Please open a folder first");
            return;
          }

          const rootPath = getRootPath(files);

          // Use rootFolderPath as fallback if rootPath is empty
          const effectiveRootPath = rootPath || rootFolderPath;

          if (!effectiveRootPath) {
            alert("Unable to determine root folder path");
            return;
          }

          // Create a temporary new file item for inline editing
          const newItem: FileEntry = {
            name: "",
            path: `${effectiveRootPath}/`,
            isDir: false,
            isEditing: true,
            isNewItem: true,
          };

          // Add the new item to the root level of the file tree
          set(state => {
            state.files = [...state.files, newItem];
          });
        },

        handleCreateNewFileInDirectory: async (dirPath: string, fileName?: string) => {
          if (!fileName) {
            fileName = prompt("Enter the name for the new file:") ?? undefined;
            if (!fileName) return;
          }

          const { useFileSystemActions } = await import("./file-system-actions");
          try {
            const result = await useFileSystemActions.getState().createFile(dirPath, fileName);
            return result;
          } catch (error) {
            console.error("Error in handleCreateNewFileInDirectory:", error);
            alert(`Failed to create file: ${error}`);
          }
        },

        handleCreateNewFolderInDirectory: async (dirPath: string, folderName?: string) => {
          if (!folderName) {
            folderName = prompt("Enter the name for the new folder:") ?? undefined;
            if (!folderName) return;
          }

          const { useFileSystemActions } = await import("./file-system-actions");
          return useFileSystemActions.getState().createDirectory(dirPath, folderName);
        },

        handleDeletePath: async (targetPath: string, isDirectory: boolean) => {
          const itemType = isDirectory ? "folder" : "file";
          const confirmMessage = isDirectory
            ? `Are you sure you want to delete the folder "${targetPath
                .split("/")
                .pop()}" and all its contents? This action cannot be undone.`
            : `Are you sure you want to delete the file "${targetPath
                .split("/")
                .pop()}"? This action cannot be undone.`;

          try {
            const confirmed = await confirm(confirmMessage, {
              title: `Delete ${itemType}`,
              okLabel: "Delete",
              cancelLabel: "Cancel",
              kind: "warning",
            });

            if (!confirmed) {
              return;
            }
          } catch (error) {
            console.error("Error showing confirm dialog:", error);
            return;
          }

          const { useFileSystemActions } = await import("./file-system-actions");
          return useFileSystemActions.getState().deleteFile(targetPath);
        },

        refreshDirectory: async (directoryPath: string) => {
          console.log(`🔄 Refreshing directory: ${directoryPath}`);

          const dirNode = findFileInTree(get().files, directoryPath);

          // If directory is not in the tree or not expanded, skip refresh
          if (!dirNode || !dirNode.isDir) {
            console.log(
              `📁 Directory ${directoryPath} not found or not a directory, skipping refresh`,
            );
            return;
          }

          // Only refresh if the directory is expanded (visible in the tree)
          if (!dirNode.expanded) {
            console.log(`📁 Directory ${directoryPath} is collapsed, skipping refresh`);
            return;
          }

          try {
            // Read the directory contents
            const entries = await readDirectory(directoryPath);

            set(state => {
              // Update the directory contents while preserving all states
              const updated = updateDirectoryContents(state.files, directoryPath, entries as any[]);

              if (updated) {
                // Successfully updated
                state.filesVersion = state.filesVersion + 1;
              } else {
                console.error(`Failed to update directory ${directoryPath} in tree`);
              }
            });
          } catch (error) {
            console.error("Error reading directory:", error);
          }
        },

        handleCollapseAllFolders: async () => {
          const { useFileTreeStore } = await import("./file-tree-store");
          const { collapseAllFolders } = await import("../utils/file-tree-utils");

          const updatedFiles = collapseAllFolders(get().files);

          set(state => {
            state.files = updatedFiles;
            state.filesVersion = state.filesVersion + 1;
          });

          useFileTreeStore.getState().collapseAll();
        },

        // Remote operations
        setRemoteConnection: (connectionId: string | null, connectionName: string | null) => {
          set(state => {
            state.isRemoteWindow = !!connectionId;
            state.remoteConnectionId = connectionId;
            state.remoteConnectionName = connectionName;
          });
        },

        handleRemoteFileSelect: async (path: string, isDir: boolean) => {
          const { remoteConnectionId } = get();
          if (!remoteConnectionId) return;

          if (isDir) {
            // TODO: Implement remote folder operations
            console.log("Remote folder toggle:", path);
          } else {
            // Import stores dynamically to avoid circular dependencies
            const { useBufferStore } = await import("./buffer-store");

            // Handle remote file open
            const { openBuffer } = useBufferStore.getState();
            const fileName = path.split("/").pop() || "Untitled";
            const remotePath = `remote://${remoteConnectionId}${path}`;

            try {
              const content = await invoke<string>("ssh_read_file", {
                connectionId: remoteConnectionId,
                filePath: path,
              });

              openBuffer(remotePath, fileName, content, false, false, false, false);
            } catch (error) {
              console.error("Error reading remote file:", error);
            }
          }
        },

        // File move/rename - updates the tree structure directly
        handleFileMove: async (oldPath: string, newPath: string) => {
          console.log(`📁 Moving file from ${oldPath} to ${newPath}`);

          const movedFile = findFileInTree(get().files, oldPath);
          if (!movedFile) {
            console.error(`Could not find ${oldPath} in file tree`);
            return;
          }

          // Remove from old location
          let updatedFiles = removeFileFromTree(get().files, oldPath);

          // Update the file's path and name
          const updatedMovedFile = {
            ...movedFile,
            path: newPath,
            name: newPath.split("/").pop() || movedFile.name,
          };

          // Determine target directory from the new path
          const targetDir =
            newPath.substring(0, newPath.lastIndexOf("/")) || get().rootFolderPath || "/";

          // Add to new location
          updatedFiles = addFileToTree(updatedFiles, targetDir, updatedMovedFile);

          set(state => {
            state.files = updatedFiles;
            state.filesVersion = state.filesVersion + 1;
            state.projectFilesCache = null;
          });

          // Import stores dynamically to avoid circular dependencies
          const { useBufferStore } = await import("./buffer-store");

          // Update open buffers
          const { buffers, updateBuffer } = useBufferStore.getState();
          const buffer = buffers.find(b => b.path === oldPath);
          if (buffer) {
            const fileName = newPath.split("/").pop() || buffer.name;
            updateBuffer({
              ...buffer,
              path: newPath,
              name: fileName,
            });
          }
        },

        // Search operations
        getAllProjectFiles: async (): Promise<FileEntry[]> => {
          const { rootFolderPath, projectFilesCache } = get();
          if (!rootFolderPath) return [];

          // Check cache first (cache for 30 seconds)
          const now = Date.now();
          if (
            projectFilesCache &&
            projectFilesCache.path === rootFolderPath &&
            now - projectFilesCache.timestamp < 30000
          ) {
            console.log(`📋 Using cached project files: ${projectFilesCache.files.length} files`);
            return projectFilesCache.files;
          }

          const allFiles: FileEntry[] = [];

          // Common directories and patterns to ignore for performance
          const IGNORE_PATTERNS = [
            // Dependencies
            "node_modules",
            "vendor",
            ".pnpm",
            ".yarn",

            // Version control
            ".git",
            ".svn",
            ".hg",

            // Build outputs
            "dist",
            "build",
            "out",
            "target",
            ".next",
            ".nuxt",

            // Cache/temp directories
            ".cache",
            "tmp",
            "temp",
            ".tmp",
            ".DS_Store",
            "Thumbs.db",

            // IDE/Editor files
            ".vscode",
            ".idea",
            "*.swp",
            "*.swo",
            "*~",

            // Logs
            "logs",
            "*.log",

            // OS generated files
            ".Spotlight-V100",
            ".Trashes",
            "ehthumbs.db",

            // Package manager locks (large files)
            "package-lock.json",
            "yarn.lock",
            "pnpm-lock.yaml",
            "Cargo.lock",
          ];

          const IGNORE_FILE_EXTENSIONS = [
            // Binary files
            ".exe",
            ".dll",
            ".so",
            ".dylib",
            ".bin",
            ".obj",
            ".o",
            ".a",

            // Large media files
            ".mov",
            ".mp4",
            ".avi",
            ".mkv",
            ".wav",
            ".mp3",
            ".flac",
            ".psd",
            ".ai",
            ".sketch",

            // Archives
            ".zip",
            ".rar",
            ".7z",
            ".tar",
            ".gz",

            // Database files
            ".db",
            ".sqlite",
            ".sqlite3",
          ];

          const shouldIgnore = (name: string, isDir: boolean): boolean => {
            const lowerName = name.toLowerCase();

            // Check ignore patterns
            for (const pattern of IGNORE_PATTERNS) {
              if (pattern.includes("*")) {
                // Simple glob pattern matching
                const regexPattern = pattern.replace(/\*/g, ".*");
                if (new RegExp(`^${regexPattern}$`).test(lowerName)) {
                  return true;
                }
              } else if (lowerName === pattern.toLowerCase()) {
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

            // Skip hidden files/folders (starting with .) except important ones
            if (
              name.startsWith(".") &&
              name !== ".env" &&
              name !== ".gitignore" &&
              name !== ".editorconfig"
            ) {
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
                    if ("requestIdleCallback" in window) {
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
          console.log(
            `✅ File scan completed: ${allFiles.length} files found in ${endTime - startTime}ms`,
          );

          // Cache the results
          set(state => {
            state.projectFilesCache = {
              path: rootFolderPath,
              files: allFiles,
              timestamp: now,
            };
          });

          return allFiles;
        },

        invalidateProjectFilesCache: () => {
          console.log("🗑️ Invalidating project files cache");
          set(state => {
            state.projectFilesCache = null;
          });
        },

        // Setter methods
        setFiles: (newFiles: FileEntry[]) => {
          set(state => {
            state.files = newFiles;
            state.filesVersion = state.filesVersion + 1;
          });
        },

        setRootFolderPath: (path: string | undefined) => {
          set(state => {
            state.rootFolderPath = path;
          });
        },

        clearProjectFilesCache: () => {
          set(state => {
            state.projectFilesCache = null;
          });
        },

        // Helper to load folder contents if needed
        loadFolderContentsIfNeeded: async (path: string) => {
          const folder = findFileInTree(get().files, path);
          if (folder?.isDir && !folder.children) {
            const contents = await readDirectoryContents(path);
            const updatedFiles = updateFileInTree(get().files, path, item => ({
              ...item,
              children: sortFileEntries(contents),
            }));
            set(state => {
              state.files = updatedFiles;
              state.filesVersion = state.filesVersion + 1;
            });
          }
        },
      }),
    ),
  ),
);

// Helper function for directory content updates (used with Immer)
function updateDirectoryContents(
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
        item.children.forEach(child => {
          existingChildrenMap.set(child.path, child);
        });
      }

      // Update children with new entries and sort them
      item.children = sortFileEntries(
        newEntries.map((entry: any) => {
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
