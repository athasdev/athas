import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { CodeEditorRef } from "../components/editor/code-editor";
import type { FileEntry, VimMode } from "../types/app";
import { getFilenameFromPath, getRootPath, isImageFile, isSQLiteFile } from "../utils/file-utils";
import type { GitDiff, GitDiffLine } from "../utils/git";
import {
  createDirectory,
  deletePath,
  openFolder,
  readDirectory,
  readFile,
  writeFile,
} from "../utils/platform";

interface FileSystemState {
  files: FileEntry[];
  rootFolderPath: string | undefined;
  expandedFolders: Set<string>;
  selectedFiles: Set<string>;
  filesVersion: number;

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

// Parse raw diff content into GitDiff format
const parseRawDiffContent = (content: string, filePath: string): GitDiff => {
  const lines = content.split("\n");
  const diffLines: GitDiffLine[] = [];
  let currentOldLine = 1;
  let currentNewLine = 1;
  let fileName = getFilenameFromPath(filePath);

  // Remove .diff or .patch extension for display
  fileName = fileName.replace(/\.(diff|patch)$/i, "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Hunk header: @@ -old_start,old_count +new_start,new_count @@
    if (line.startsWith("@@")) {
      const hunkMatch = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@(.*)?/);
      if (hunkMatch) {
        currentOldLine = parseInt(hunkMatch[1]);
        currentNewLine = parseInt(hunkMatch[2]);

        diffLines.push({
          line_type: "header",
          content: line,
          old_line_number: undefined,
          new_line_number: undefined,
        });
      }
      continue;
    }

    // File headers (ignore for now)
    if (
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("diff ") ||
      line.startsWith("index ")
    ) {
      continue;
    }

    // Added line
    if (line.startsWith("+")) {
      diffLines.push({
        line_type: "added",
        content: line.substring(1), // Remove the + prefix
        old_line_number: undefined,
        new_line_number: currentNewLine,
      });
      currentNewLine++;
    }
    // Removed line
    else if (line.startsWith("-")) {
      diffLines.push({
        line_type: "removed",
        content: line.substring(1), // Remove the - prefix
        old_line_number: currentOldLine,
        new_line_number: undefined,
      });
      currentOldLine++;
    }
    // Context line (unchanged)
    else if (line.startsWith(" ")) {
      diffLines.push({
        line_type: "context",
        content: line.substring(1), // Remove the space prefix
        old_line_number: currentOldLine,
        new_line_number: currentNewLine,
      });
      currentOldLine++;
      currentNewLine++;
    }
    // Empty line or other content
    else if (line.trim()) {
      diffLines.push({
        line_type: "context",
        content: line,
        old_line_number: currentOldLine,
        new_line_number: currentNewLine,
      });
      currentOldLine++;
      currentNewLine++;
    }
  }

  return {
    file_path: fileName,
    old_path: undefined,
    new_path: undefined,
    is_new: false,
    is_deleted: false,
    is_renamed: false,
    is_binary: false,
    is_image: false,
    old_blob_base64: undefined,
    new_blob_base64: undefined,
    lines: diffLines,
  };
};

export const useFileSystemStore = create(
  immer(
    combine(
      {
        files: [],
        rootFolderPath: undefined as string | undefined,
        expandedFolders: new Set<string>(),
        selectedFiles: new Set<string>(),
        filesVersion: 0,
        isRemoteWindow: false,
        remoteConnectionId: null,
        remoteConnectionName: null,
        projectFilesCache: null,
      } as FileSystemState,
      (set, get) => ({
        // Folder operations
        handleOpenFolder: async () => {
          try {
            const selected = await openFolder();

            if (selected) {
              const entries = await readDirectory(selected);
              const fileTree = (entries as any[]).map((entry: any) => ({
                name: entry.name || "Unknown",
                path: entry.path || `${selected}/${entry.name}`,
                isDir: entry.is_dir || false,
                expanded: false,
                children: undefined,
              }));

              set(state => {
                state.rootFolderPath = selected;
                state.files = fileTree;
                state.expandedFolders = new Set<string>();
                state.projectFilesCache = null;
                state.filesVersion = state.filesVersion + 1;
              });

              // Import stores dynamically to avoid circular dependencies
              const { useProjectStore } = await import("./project-store");
              const { useFileWatcherStore } = await import("./file-watcher-store");
              const { useRecentFoldersStore } = await import("./recent-folders-store");

              // Update project store
              const { setRootFolderPath, setProjectName } = useProjectStore.getState();
              setRootFolderPath(selected);
              setProjectName(selected.split("/").pop() || "Project");

              // Add to recent folders
              const { addToRecents } = useRecentFoldersStore.getState();
              addToRecents(selected);

              // Start file watching
              const { setProjectRoot } = useFileWatcherStore.getState();
              await setProjectRoot(selected);
              return true;
            }
            return false;
          } catch (error) {
            console.error("Error opening folder:", error);
            return false;
          }
        },

        handleOpenFolderByPath: async (path: string) => {
          try {
            const entries = await readDirectory(path);
            const fileTree = (entries as any[]).map((entry: any) => ({
              name: entry.name || "Unknown",
              path: entry.path || `${path}/${entry.name}`,
              isDir: entry.is_dir || false,
              expanded: false,
              children: undefined,
            }));

            set(state => {
              state.rootFolderPath = path;
              state.files = fileTree;
              state.expandedFolders = new Set<string>();
              state.projectFilesCache = null;
              state.filesVersion = state.filesVersion + 1;
            });

            // Import stores dynamically to avoid circular dependencies
            const { useProjectStore } = await import("./project-store");
            const { useFileWatcherStore } = await import("./file-watcher-store");
            const { useRecentFoldersStore } = await import("./recent-folders-store");

            // Update project store
            const { setRootFolderPath, setProjectName } = useProjectStore.getState();
            setRootFolderPath(path);
            setProjectName(path.split("/").pop() || "Project");

            // Add to recent folders
            const { addToRecents } = useRecentFoldersStore.getState();
            addToRecents(path);

            // Start file watching
            const { setProjectRoot } = useFileWatcherStore.getState();
            await setProjectRoot(path);

            return true;
          } catch (error) {
            console.error("Error opening folder by path:", error);
            return false;
          }
        },

        loadFolderContents: async (path: string) => {
          try {
            const entries = await readDirectory(path);
            const fileTree = (entries as any[]).map((entry: any) => ({
              name: entry.name || "Unknown",
              path: entry.path || `${path}/${entry.name}`,
              isDir: entry.is_dir || false,
              expanded: false,
              children: undefined,
            }));

            set(state => {
              state.rootFolderPath = path;
              state.files = fileTree;
              state.expandedFolders = new Set<string>();
              state.projectFilesCache = null;
              state.filesVersion = state.filesVersion + 1;
            });

            // Import stores dynamically to avoid circular dependencies
            const { useProjectStore } = await import("./project-store");
            const { useFileWatcherStore } = await import("./file-watcher-store");

            // Update project store
            const { setRootFolderPath, setProjectName } = useProjectStore.getState();
            setRootFolderPath(path);
            setProjectName(path.split("/").pop() || "Project");

            // Start file watching
            const { setProjectRoot } = useFileWatcherStore.getState();
            await setProjectRoot(path);
          } catch (error) {
            console.error("Error loading folder contents:", error);
            throw error;
          }
        },

        // File operations
        handleFileSelect: async (
          path: string,
          isDir: boolean,
          line?: number,
          column?: number,
          vimEnabled?: boolean,
          setVimMode?: (mode: VimMode) => void,
          updateCursorPosition?: () => void,
          codeEditorRef?: React.RefObject<CodeEditorRef | null>,
        ) => {
          if (isDir) {
            const { isRemoteWindow, remoteConnectionId } = get();

            if (isRemoteWindow && remoteConnectionId) {
              // Implementation for remote folder operations
              set(state => {
                const expanded = new Set(state.expandedFolders);
                if (expanded.has(path)) {
                  expanded.delete(path);
                } else {
                  expanded.add(path);
                }
                state.expandedFolders = expanded;
              });

              // TODO: Implement remote folder content loading
            } else {
              // Handle local folder toggle
              const updateFiles = async (items: FileEntry[]): Promise<FileEntry[]> => {
                return Promise.all(
                  items.map(async item => {
                    if (item.path === path && item.isDir) {
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

              const { files } = get();
              const updatedFiles = await updateFiles(files);

              set(state => {
                state.files = updatedFiles;
                state.filesVersion = state.filesVersion + 1;
              });
            }
            return;
          }

          const fileName = getFilenameFromPath(path);

          // Import stores dynamically to avoid circular dependencies
          const { useBufferStore } = await import("./buffer-store");
          // We don't need to use LSP here since it's handled by App.tsx
          // which already has the proper LSP integration

          const { openBuffer } = useBufferStore.getState();

          // Handle virtual diff files
          if (path.startsWith("diff://")) {
            const diffContent = localStorage.getItem(`diff-content-${path}`);
            if (diffContent) {
              openBuffer(path, fileName, diffContent, false, false, true, true); // Mark as diff and virtual
              return;
            } else {
              openBuffer(path, fileName, "No diff content available", false, false, true, true);
              return;
            }
          }

          if (isSQLiteFile(path)) {
            openBuffer(path, fileName, "", true, false, false, false);
          } else if (isImageFile(path)) {
            openBuffer(path, fileName, "", false, true, false, false);
          } else {
            try {
              const content = await readFile(path);

              // Ensure content is not empty/undefined
              const safeContent = content || "";

              // Check if this is a diff/patch file by extension or content
              const isDiffFile = /\.(diff|patch)$/i.test(path) || safeContent.includes("@@");

              if (isDiffFile && safeContent.includes("@@")) {
                // Parse raw diff content into GitDiff format
                const parsedDiff = parseRawDiffContent(safeContent, path);
                const diffJson = JSON.stringify(parsedDiff);
                openBuffer(path, fileName, diffJson, false, false, true, false);
              } else {
                openBuffer(path, fileName, safeContent, false, false, false, false);
              }

              // Navigate to specific line/column if provided
              if (line && column && codeEditorRef?.current?.textarea) {
                // Use requestAnimationFrame for immediate but smooth execution
                requestAnimationFrame(() => {
                  if (codeEditorRef.current?.textarea) {
                    const textarea = codeEditorRef.current.textarea;
                    const lines = content.split("\n");
                    let targetPosition = 0;

                    // Calculate position based on line and column
                    for (let i = 0; i < line - 1 && i < lines.length; i++) {
                      targetPosition += lines[i].length + 1; // +1 for newline
                    }
                    if (column) {
                      targetPosition += Math.min(column - 1, lines[line - 1]?.length || 0);
                    }

                    textarea.focus();
                    if (
                      "setSelectionRange" in textarea &&
                      typeof textarea.setSelectionRange === "function"
                    ) {
                      (textarea as unknown as HTMLTextAreaElement).setSelectionRange(
                        targetPosition,
                        targetPosition,
                      );
                    }

                    // Scroll to the line
                    const lineHeight = 20; // Approximate line height
                    const scrollTop = Math.max(
                      0,
                      (line - 1) * lineHeight - textarea.clientHeight / 2,
                    );
                    textarea.scrollTop = scrollTop;
                  }
                });
              }

              // Reset vim mode when opening new file
              if (vimEnabled && setVimMode && updateCursorPosition) {
                setVimMode("normal");
                // Update cursor position immediately after vim mode change
                requestAnimationFrame(() => {
                  updateCursorPosition();
                });
              }

              // LSP document opening is handled by App.tsx
            } catch (error) {
              console.error("Error reading file:", error);
              openBuffer(
                path,
                fileName,
                `Error reading file: ${error}`,
                false,
                false,
                false,
                false,
              );
            }
          }
        },

        toggleFolder: async (path: string) => {
          const { isRemoteWindow, remoteConnectionId } = get();

          if (isRemoteWindow && remoteConnectionId) {
            // Implementation for remote folder operations
            set(state => {
              const expanded = new Set(state.expandedFolders);
              if (expanded.has(path)) {
                expanded.delete(path);
              } else {
                expanded.add(path);
              }
              state.expandedFolders = expanded;
            });

            // TODO: Implement remote folder content loading
          } else {
            // Handle local folder toggle
            const updateFiles = async (items: FileEntry[]): Promise<FileEntry[]> => {
              return Promise.all(
                items.map(async item => {
                  if (item.path === path && item.isDir) {
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

            const { files } = get();
            const updatedFiles = await updateFiles(files);

            set(state => {
              state.files = updatedFiles;
              state.filesVersion = state.filesVersion + 1;
            });
          }
        },

        handleRemoteFolderToggle: async (path: string) => {
          // Implementation for remote folder operations
          set(state => {
            const expanded = new Set(state.expandedFolders);
            if (expanded.has(path)) {
              expanded.delete(path);
            } else {
              expanded.add(path);
            }
            state.expandedFolders = expanded;
          });

          // TODO: Implement remote folder content loading
        },

        handleCreateNewFile: async () => {
          const { rootFolderPath, files } = get();
          if (!rootFolderPath) {
            alert("Please open a folder first");
            return;
          }

          const rootPath = getRootPath(files);

          // Create a temporary new file item for inline editing
          const newItem: FileEntry = {
            name: "",
            path: `${rootPath}/`,
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
          // If no fileName provided, use the old prompt method for backward compatibility
          if (!fileName) {
            fileName = prompt("Enter the name for the new file:") ?? undefined;
            if (!fileName) return;
          }

          try {
            const newFilePath = dirPath ? `${dirPath}/${fileName}` : fileName;
            console.log("📁 Creating new file:", newFilePath);

            // Create an empty file
            await writeFile(newFilePath, "");
            console.log("✅ File created successfully");

            // Invalidate project files cache
            set(state => {
              state.projectFilesCache = null;
            });

            // Refresh directory inline
            const entries = await readDirectory(get().rootFolderPath || ".");
            const fileTree = (entries as any[]).map((entry: any) => ({
              name: entry.name || "Unknown",
              path: entry.path || `${get().rootFolderPath}/${entry.name}`,
              isDir: entry.is_dir || false,
              expanded: false,
              children: undefined,
            }));

            set(state => {
              state.files = fileTree;
              state.filesVersion = state.filesVersion + 1;
              state.projectFilesCache = null;
            });

            // Open the new file
            const newFileName = newFilePath.split("/").pop() || "";
            const { useBufferStore } = await import("./buffer-store");
            const { openBuffer } = useBufferStore.getState();
            openBuffer(newFilePath, newFileName, "", false, false, false, false);
          } catch (error) {
            console.error("Error creating file:", error);
            alert("Failed to create file");
          }
        },

        handleCreateNewFolderInDirectory: async (dirPath: string, folderName?: string) => {
          // If no folderName provided, use the old prompt method for backward compatibility
          if (!folderName) {
            folderName = prompt("Enter the name for the new folder:") ?? undefined;
            if (!folderName) return;
          }

          try {
            const newFolderPath = dirPath ? `${dirPath}/${folderName}` : folderName;
            console.log("📁 Creating new folder:", newFolderPath);

            // Create the directory
            await createDirectory(newFolderPath);
            console.log("✅ Folder created successfully");

            // Invalidate project files cache
            set(state => {
              state.projectFilesCache = null;
            });

            // Refresh directory inline
            const entries = await readDirectory(get().rootFolderPath || ".");
            const fileTree = (entries as any[]).map((entry: any) => ({
              name: entry.name || "Unknown",
              path: entry.path || `${get().rootFolderPath}/${entry.name}`,
              isDir: entry.is_dir || false,
              expanded: false,
              children: undefined,
            }));

            set(state => {
              state.files = fileTree;
              state.filesVersion = state.filesVersion + 1;
              state.projectFilesCache = null;
            });
          } catch (error) {
            console.error("Error creating folder:", error);
            alert("Failed to create folder");
          }
        },

        handleDeletePath: async (targetPath: string, isDirectory: boolean) => {
          const itemType = isDirectory ? "folder" : "file";
          const confirmMessage = isDirectory
            ? `Are you sure you want to delete the folder "${targetPath.split("/").pop()}" and all its contents? This action cannot be undone.`
            : `Are you sure you want to delete the file "${targetPath.split("/").pop()}"? This action cannot be undone.`;

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

          try {
            // Delete the file or directory
            await deletePath(targetPath);

            // Invalidate project files cache
            set(state => {
              state.projectFilesCache = null;
            });

            const parentPath = targetPath.split("/").slice(0, -1).join("/");
            // Refresh parent directory
            const refreshPath = parentPath || get().rootFolderPath || ".";
            const entries = await readDirectory(refreshPath);
            const fileTree = (entries as any[]).map((entry: any) => ({
              name: entry.name || "Unknown",
              path: entry.path || `${refreshPath}/${entry.name}`,
              isDir: entry.is_dir || false,
              expanded: false,
              children: undefined,
            }));

            set(state => {
              state.files = fileTree;
              state.filesVersion = state.filesVersion + 1;
              state.projectFilesCache = null;
            });

            // Import stores dynamically to avoid circular dependencies
            const { useBufferStore } = await import("./buffer-store");

            // Close buffer if file is open
            const { buffers, closeBuffer } = useBufferStore.getState();
            const buffer = buffers.find(b => b.path === targetPath);
            if (buffer) {
              closeBuffer(buffer.id);
            }
          } catch (error) {
            console.error(`Error deleting ${itemType}:`, error);
            alert(`Failed to delete ${itemType}`);
          }
        },

        refreshDirectory: async (directoryPath: string) => {
          console.log(`🔄 Refreshing directory: ${directoryPath}`);

          const updateFiles = async (items: FileEntry[]): Promise<FileEntry[]> => {
            return Promise.all(
              items.map(async item => {
                if (item.path === directoryPath && item.isDir) {
                  // Refresh this directory
                  try {
                    const entries = await readDirectory(item.path);

                    // Create a map of existing children to preserve their expanded states
                    const existingChildrenMap = new Map<string, FileEntry>();
                    if (item.children) {
                      item.children.forEach(child => {
                        existingChildrenMap.set(child.path, child);
                      });
                    }

                    const children = (entries as any[]).map((entry: any) => {
                      const existingChild = existingChildrenMap.get(entry.path);
                      return {
                        name: entry.name || "Unknown",
                        path: entry.path,
                        isDir: entry.is_dir || false,
                        expanded: existingChild?.expanded || false,
                        children: existingChild?.children || undefined,
                      };
                    });
                    // Keep the expanded state if it was already expanded
                    return {
                      ...item,
                      children,
                      expanded: item.expanded !== undefined ? item.expanded : true,
                    };
                  } catch (error) {
                    console.error("Error refreshing directory:", error);
                    return item;
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

          const { files, rootFolderPath } = get();
          const updatedFiles = await updateFiles(files);

          // Check if the directory was found and updated
          let directoryFound = false;
          const checkIfDirectoryFound = (items: FileEntry[]): boolean => {
            for (const item of items) {
              if (item.path === directoryPath && item.isDir) {
                return true;
              }
              if (item.children && checkIfDirectoryFound(item.children)) {
                return true;
              }
            }
            return false;
          };

          directoryFound = checkIfDirectoryFound(updatedFiles);

          // If directory wasn't found in the tree, it might be because parent directories aren't expanded
          // In this case, refresh from the root
          if (!directoryFound && rootFolderPath) {
            console.log(`📁 Directory ${directoryPath} not found in tree, refreshing from root`);
            try {
              const entries = await readDirectory(rootFolderPath);
              const fileTree = (entries as any[]).map((entry: any) => ({
                name: entry.name || "Unknown",
                path: entry.path || `${rootFolderPath}/${entry.name}`,
                isDir: entry.is_dir || false,
                expanded: false,
                children: undefined,
              }));

              set(state => {
                state.files = fileTree;
                state.filesVersion = state.filesVersion + 1;
                state.projectFilesCache = null;
              });
              return;
            } catch (error) {
              console.error("Error refreshing root directory:", error);
            }
          }

          set(state => {
            state.files = updatedFiles;
            state.filesVersion = state.filesVersion + 1;
          });
        },

        handleCollapseAllFolders: () => {
          const collapseFiles = (items: FileEntry[]): FileEntry[] => {
            return items.map(item => {
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

          const { files } = get();
          const updatedFiles = collapseFiles(files);

          set(state => {
            state.files = updatedFiles;
            state.filesVersion = state.filesVersion + 1;
          });
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
            // Implementation for remote folder operations
            set(state => {
              const expanded = new Set(state.expandedFolders);
              if (expanded.has(path)) {
                expanded.delete(path);
              } else {
                expanded.add(path);
              }
              state.expandedFolders = expanded;
            });

            // TODO: Implement remote folder content loading
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

        // File move/rename
        handleFileMove: async (oldPath: string, newPath: string) => {
          try {
            // Update file system
            // TODO: Implement moveFile utility
            // await moveFile(oldPath, newPath);

            // Refresh directories
            // Refresh old directory
            const entries = await readDirectory(get().rootFolderPath || ".");
            const fileTree = (entries as any[]).map((entry: any) => ({
              name: entry.name || "Unknown",
              path: entry.path || `${get().rootFolderPath}/${entry.name}`,
              isDir: entry.is_dir || false,
              expanded: false,
              children: undefined,
            }));

            set(state => {
              state.files = fileTree;
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
          } catch (error) {
            console.error("Error moving file:", error);
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

        // Setter for files (used by drag and drop operations)
        setFiles: (newFiles: FileEntry[]) => {
          set(state => {
            state.files = newFiles;
            state.filesVersion = state.filesVersion + 1;
          });
        },

        // Helper to load folder contents if needed
        loadFolderContentsIfNeeded: async (path: string) => {
          // Implementation to lazily load folder contents
          const { files } = get();
          const folder = findFileEntry(files, path);
          if (folder?.isDir && !folder.children) {
            const contents = await readDirectory(path);
            set(state => {
              updateFileTree(state.files, path, contents);
            });
          }
        },
      }),
    ),
  ),
);

// Helper functions
function updateFileTree(files: FileEntry[], dirPath: string, newContents: FileEntry[]): void {
  const updateRecursive = (items: FileEntry[]): boolean => {
    for (const item of items) {
      if (item.path === dirPath) {
        item.children = newContents;
        return true;
      }
      if (item.children && updateRecursive(item.children)) {
        return true;
      }
    }
    return false;
  };
  updateRecursive(files);
}

function findFileEntry(files: FileEntry[], path: string): FileEntry | null {
  for (const file of files) {
    if (file.path === path) return file;
    if (file.children) {
      const found = findFileEntry(file.children, path);
      if (found) return found;
    }
  }
  return null;
}
