import { basename, dirname, extname, join } from "@tauri-apps/api/path";
import { confirm } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { CodeEditorRef } from "@/components/editor/code-editor";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { editorAPI } from "@/extensions/editor-api";
import { useFileTreeStore } from "@/file-explorer/controllers/file-tree-store";
// Store imports - Note: Direct store communication via getState() is used here.
// This is an acceptable Zustand pattern, though it creates coupling between stores.
// See: https://github.com/pmndrs/zustand/discussions/1319
import { useBufferStore } from "@/stores/buffer-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useProjectStore } from "@/stores/project-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { createSelectors } from "@/utils/zustand-selectors";
import { getGitStatus } from "@/version-control/git/controllers/git";
import { gitDiffCache } from "@/version-control/git/controllers/git-diff-cache";
import { isDiffFile, parseRawDiffContent } from "@/version-control/git/controllers/git-diff-parser";
import { useGitStore } from "@/version-control/git/controllers/git-store";
import type { FileEntry } from "../models/app";
import type { FsActions, FsState } from "../models/interface";
import {
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
  readDirectoryContents,
  readFileContent,
} from "./file-operations";
import {
  addFileToTree,
  collapseAllFolders,
  findFileInTree,
  removeFileFromTree,
  sortFileEntries,
  updateFileInTree,
} from "./file-tree-utils";
import { getFilenameFromPath, isImageFile, isSQLiteFile } from "./file-utils";
import { useFileWatcherStore } from "./file-watcher-store";
import { openFolder, readDirectory, renameFile } from "./platform";
import { useRecentFoldersStore } from "./recent-folders-store";
import { shouldIgnore, updateDirectoryContents } from "./utils";

export const useFileSystemStore = createSelectors(
  create<FsState & FsActions>()(
    immer((set, get) => ({
      // State
      files: [],
      rootFolderPath: undefined,
      filesVersion: 0,
      isFileTreeLoading: false,
      isRemoteWindow: false,
      remoteConnectionId: undefined,
      remoteConnectionName: undefined,
      projectFilesCache: undefined,

      // Actions
      handleOpenFolder: async () => {
        set((state) => {
          state.isFileTreeLoading = true;
        });

        const selected = await openFolder();

        if (!selected) {
          set((state) => {
            state.isFileTreeLoading = false;
          });
          return false;
        }

        const entries = await readDirectoryContents(selected);
        const fileTree = sortFileEntries(entries);

        // Clear tree UI state
        useFileTreeStore.getState().collapseAll();

        // Update project store
        const { setRootFolderPath, setProjectName } = useProjectStore.getState();
        setRootFolderPath(selected);
        setProjectName(selected.split("/").pop() || "Project");

        // Add to recent folders
        useRecentFoldersStore.getState().addToRecents(selected);

        // Start file watching
        await useFileWatcherStore.getState().setProjectRoot(selected);

        // Initialize git status
        const gitStatus = await getGitStatus(selected);
        useGitStore.getState().actions.setGitStatus(gitStatus);

        // Clear git diff cache for new project
        gitDiffCache.clear();

        set((state) => {
          state.isFileTreeLoading = false;
          state.files = fileTree;
          state.rootFolderPath = selected;
          state.filesVersion++;
          state.projectFilesCache = undefined;
        });

        return true;
      },

      closeFolder: async () => {
        // Reset all project-related state to return to welcome screen
        set((state) => {
          state.files = [];
          state.isFileTreeLoading = false;
          state.filesVersion++;
        });

        // Clear tree UI state
        useFileTreeStore.getState().collapseAll();

        // Reset project store
        const { setRootFolderPath, setProjectName } = useProjectStore.getState();
        setRootFolderPath("");
        setProjectName("");

        // Close all buffers (close them individually since closeAllBuffers doesn't exist)
        const { buffers, actions: bufferActions } = useBufferStore.getState();
        buffers.forEach((buffer) => bufferActions.closeBuffer(buffer.id));

        // Stop file watching
        await useFileWatcherStore.getState().setProjectRoot("");

        // Reset git store
        const { actions: gitActions } = useGitStore.getState();
        gitActions.resetCommits();

        // Clear git diff cache
        gitDiffCache.clear();

        return true;
      },

      handleOpenFolderByPath: async (path: string) => {
        set((state) => {
          state.isFileTreeLoading = true;
        });

        const entries = await readDirectoryContents(path);
        const fileTree = sortFileEntries(entries);

        // Clear tree UI state
        useFileTreeStore.getState().collapseAll();

        // Update project store
        const { setRootFolderPath, setProjectName } = useProjectStore.getState();
        setRootFolderPath(path);
        setProjectName(path.split("/").pop() || "Project");

        // Add to recent folders
        useRecentFoldersStore.getState().addToRecents(path);

        // Start file watching
        await useFileWatcherStore.getState().setProjectRoot(path);

        // Initialize git status
        const gitStatus = await getGitStatus(path);
        useGitStore.getState().actions.setGitStatus(gitStatus);

        // Clear git diff cache for new project
        gitDiffCache.clear();

        set((state) => {
          state.isFileTreeLoading = false;
          state.files = fileTree;
          state.rootFolderPath = path;
          state.filesVersion++;
          state.projectFilesCache = undefined;
        });

        return true;
      },

      handleFileSelect: async (
        path: string,
        isDir: boolean,
        line?: number,
        column?: number,
        codeEditorRef?: React.RefObject<CodeEditorRef | null>,
      ) => {
        const { updateActivePath } = useSidebarStore.getState();

        if (isDir) {
          await get().toggleFolder(path);
          return;
        }

        updateActivePath(path);
        const fileName = getFilenameFromPath(path);
        const { openBuffer } = useBufferStore.getState().actions;

        // Handle virtual diff files
        if (path.startsWith("diff://")) {
          const match = path.match(/^diff:\/\/(staged|unstaged)\/(.+)$/);
          let displayName = getFilenameFromPath(path);
          if (match) {
            const [, diffType, encodedPath] = match;
            const decodedPath = decodeURIComponent(encodedPath);
            displayName = `${getFilenameFromPath(decodedPath)} (${diffType})`;
          }

          const diffContent = localStorage.getItem(`diff-content-${path}`);
          if (diffContent) {
            openBuffer(path, displayName, diffContent, false, false, true, true);
          } else {
            openBuffer(path, displayName, "No diff content available", false, false, true, true);
          }
          return;
        }

        // Handle special file types
        if (isSQLiteFile(path)) {
          openBuffer(path, fileName, "", false, true, false, false);
        } else if (isImageFile(path)) {
          openBuffer(path, fileName, "", true, false, false, false);
        } else {
          const content = await readFileContent(path);

          // Check if this is a diff file
          if (isDiffFile(path, content)) {
            const parsedDiff = parseRawDiffContent(content, path);
            const diffJson = JSON.stringify(parsedDiff);
            openBuffer(path, fileName, diffJson, false, false, true, false);
          } else {
            openBuffer(path, fileName, content, false, false, false, false);
          }

          // Handle navigation to specific line/column
          if (line && column && codeEditorRef?.current?.textarea) {
            requestAnimationFrame(() => {
              if (codeEditorRef.current?.textarea) {
                const textarea = codeEditorRef.current.textarea;
                const lines = content.split("\n");
                let targetPosition = 0;

                if (line) {
                  for (let i = 0; i < line - 1 && i < lines.length; i++) {
                    targetPosition += lines[i].length + 1;
                  }
                  if (column) {
                    targetPosition += Math.min(column - 1, lines[line - 1]?.length || 0);
                  }
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

                const lineHeight = 20;
                const scrollTop = line
                  ? Math.max(0, (line - 1) * lineHeight - textarea.clientHeight / 2)
                  : 0;
                textarea.scrollTop = scrollTop;
              }
            });
          }
        }

        // Scroll to line if specified
        if (line) {
          const textarea = document.querySelector(
            "textarea.editor-textarea",
          ) as HTMLTextAreaElement;
          if (textarea) {
            const { fontSize } = useEditorSettingsStore.getState();
            const lineHeight = Math.ceil(fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER);
            const targetScrollTop = Math.max(0, (line - 1) * lineHeight);

            const viewport = editorAPI.getViewportRef();
            if (viewport) {
              viewport.scrollTop = targetScrollTop;
            }
          }
        }
      },

      toggleFolder: async (path: string) => {
        const { isRemoteWindow, remoteConnectionId } = get();

        if (isRemoteWindow && remoteConnectionId) {
          // TODO: Implement remote folder operations
          return;
        }

        const folder = findFileInTree(get().files, path);

        if (!folder || !folder.isDir) return;

        if (!folder.expanded) {
          // Expand folder - load children
          const entries = await readDirectoryContents(folder.path);
          const updatedFiles = updateFileInTree(get().files, path, (item) => ({
            ...item,
            expanded: true,
            children: sortFileEntries(entries),
          }));

          useFileTreeStore.getState().toggleFolder(path);

          set((state) => {
            state.files = updatedFiles;
            state.filesVersion++;
          });
        } else {
          // Collapse folder
          const updatedFiles = updateFileInTree(get().files, path, (item) => ({
            ...item,
            expanded: false,
          }));

          useFileTreeStore.getState().toggleFolder(path);

          set((state) => {
            state.files = updatedFiles;
            state.filesVersion++;
          });
        }
      },

      handleCreateNewFile: async () => {
        const { rootFolderPath } = get();
        const { activePath } = useSidebarStore.getState();

        if (!rootFolderPath) {
          alert("Please open a folder first");
          return;
        }

        let effectiveRootPath = activePath || rootFolderPath;

        // Active path maybe is a file
        if (activePath) {
          try {
            await extname(activePath);
            effectiveRootPath = await dirname(activePath);
          } catch {}
        }

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
        set((state) => {
          state.files = addFileToTree(state.files, effectiveRootPath, newItem);
          state.filesVersion++;
        });
      },

      handleCreateNewFileInDirectory: async (dirPath: string, fileName?: string) => {
        if (!fileName) {
          fileName = prompt("Enter the name for the new file:") ?? undefined;
          if (!fileName) return;
        }

        return get().createFile(dirPath, fileName);
      },

      handleCreateNewFolder: async () => {
        const { rootFolderPath } = get();
        const { activePath } = useSidebarStore.getState();

        if (!rootFolderPath) {
          alert("Please open a folder first");
          return;
        }

        let effectiveRootPath = activePath || rootFolderPath;

        // Active path maybe is a file
        if (activePath) {
          try {
            await extname(activePath);
            effectiveRootPath = await dirname(activePath);
          } catch {}
        }

        if (!effectiveRootPath) {
          alert("Unable to determine root folder path");
          return;
        }

        const newFolder: FileEntry = {
          name: "",
          path: `${effectiveRootPath}/`,
          isDir: true,
          isEditing: true,
          isNewItem: true,
        };

        set((state) => {
          state.files = addFileToTree(state.files, effectiveRootPath, newFolder);
          state.filesVersion++;
        });
      },

      handleCreateNewFolderInDirectory: async (dirPath: string, folderName?: string) => {
        if (!folderName) {
          folderName = prompt("Enter the name for the new folder:") ?? undefined;
          if (!folderName) return;
        }

        return get().createDirectory(dirPath, folderName);
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

        const confirmed = await confirm(confirmMessage, {
          title: `Delete ${itemType}`,
          okLabel: "Delete",
          cancelLabel: "Cancel",
          kind: "warning",
        });

        if (!confirmed) return;

        return get().deleteFile(targetPath);
      },

      refreshDirectory: async (directoryPath: string) => {
        const dirNode = findFileInTree(get().files, directoryPath);

        // If directory is not in the tree or not expanded, skip refresh
        if (!dirNode || !dirNode.isDir) {
          return;
        }

        // Only refresh if the directory is expanded (visible in the tree)
        if (!dirNode.expanded) {
          return;
        }

        // Read the directory contents
        const entries = await readDirectory(directoryPath);

        set((state) => {
          // Update the directory contents while preserving all states
          const updated = updateDirectoryContents(state.files, directoryPath, entries as any[]);

          if (updated) {
            // Successfully updated
            state.filesVersion++;
          }
        });
      },

      handleCollapseAllFolders: async () => {
        const updatedFiles = collapseAllFolders(get().files);

        set((state) => {
          state.files = updatedFiles;
          state.filesVersion++;
        });

        useFileTreeStore.getState().collapseAll();
      },

      handleFileMove: async (oldPath: string, newPath: string) => {
        const movedFile = findFileInTree(get().files, oldPath);
        if (!movedFile) {
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

        set((state) => {
          state.files = updatedFiles;
          state.filesVersion = state.filesVersion + 1;
          state.projectFilesCache = undefined;
        });

        // Update open buffers
        const { buffers } = useBufferStore.getState();
        const { updateBuffer } = useBufferStore.getState().actions;
        const buffer = buffers.find((b) => b.path === oldPath);
        if (buffer) {
          const fileName = newPath.split("/").pop() || buffer.name;
          updateBuffer({
            ...buffer,
            path: newPath,
            name: fileName,
          });
        }

        // Invalidate git diff cache for moved files
        const { rootFolderPath } = get();
        if (rootFolderPath) {
          gitDiffCache.invalidate(rootFolderPath, oldPath);
          gitDiffCache.invalidate(rootFolderPath, newPath);
        }
      },

      getAllProjectFiles: async (): Promise<FileEntry[]> => {
        const { rootFolderPath, projectFilesCache } = get();
        if (!rootFolderPath) return [];

        // Check cache first (cache for 5 minutes for better UX)
        const now = Date.now();
        if (
          projectFilesCache &&
          projectFilesCache.path === rootFolderPath &&
          now - projectFilesCache.timestamp < 300000 // 5 minutes
        ) {
          return projectFilesCache.files;
        }

        // Return cached files immediately if available, then update in background
        const cachedFiles = projectFilesCache?.files || [];

        // Background update - don't await this
        setTimeout(async () => {
          try {
            const allFiles: FileEntry[] = [];
            let processedFiles = 0;
            const MAX_FILES = 5000; // Limit total files processed for performance

            const scanDirectory = async (
              directoryPath: string,
              depth: number = 0,
            ): Promise<boolean> => {
              // Prevent infinite recursion and very deep scanning
              if (depth > 8 || processedFiles > MAX_FILES) {
                return false; // Signal to stop scanning
              }

              try {
                const entries = await readDirectory(directoryPath);

                for (const entry of entries as any[]) {
                  if (processedFiles > MAX_FILES) break;

                  const name = entry.name || "Unknown";
                  const isDir = entry.is_dir || false;

                  // Skip ignored files/directories early
                  if (shouldIgnore(name, isDir)) {
                    continue;
                  }

                  processedFiles++;

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
                    const shouldContinue = await scanDirectory(fileEntry.path, depth + 1);
                    if (!shouldContinue) break;
                  }

                  // Yield control more frequently for better UI responsiveness
                  if (processedFiles % 100 === 0) {
                    await new Promise((resolve) => {
                      if ("requestIdleCallback" in window) {
                        requestIdleCallback(resolve, { timeout: 4 });
                      } else {
                        setTimeout(resolve, 1);
                      }
                    });
                  }
                }
              } catch (error) {
                console.warn(`Failed to scan directory ${directoryPath}:`, error);
                return false;
              }

              return true;
            };

            await scanDirectory(rootFolderPath);

            // Update cache with new results
            set((state) => {
              state.projectFilesCache = {
                path: rootFolderPath,
                files: allFiles,
                timestamp: now,
              };
            });

            console.log(`Indexed ${allFiles.length} files for command palette`);
          } catch (error) {
            console.error("Failed to index project files:", error);
          }
        }, 0);

        return cachedFiles;
      },

      createFile: async (directoryPath: string, fileName: string) => {
        const filePath = await createNewFile(directoryPath, fileName);

        const newFile: FileEntry = {
          name: fileName,
          path: filePath,
          isDir: false,
          expanded: false,
        };

        set((state) => {
          state.files = addFileToTree(state.files, directoryPath, newFile);
          state.filesVersion++;
        });

        return filePath;
      },

      createDirectory: async (parentPath: string, folderName: string) => {
        const folderPath = await createNewDirectory(parentPath, folderName);

        const newFolder: FileEntry = {
          name: folderName,
          path: folderPath,
          isDir: true,
          expanded: false,
          children: [],
        };

        set((state) => {
          state.files = addFileToTree(state.files, parentPath, newFolder);
          state.filesVersion++;
        });

        return folderPath;
      },

      deleteFile: async (path: string) => {
        await deleteFileOrDirectory(path);

        const { buffers, actions } = useBufferStore.getState();
        buffers
          .filter((buffer) => buffer.path === path)
          .forEach((buffer) => actions.closeBuffer(buffer.id));

        // Invalidate git diff cache for deleted file
        const { rootFolderPath } = get();
        if (rootFolderPath) {
          gitDiffCache.invalidate(rootFolderPath, path);
        }

        set((state) => {
          state.files = removeFileFromTree(state.files, path);
          state.filesVersion++;
        });
      },

      handleRevealInFolder: async (path: string) => {
        await revealItemInDir(path);
      },

      handleDuplicatePath: async (path: string) => {
        const dir = await dirname(path);
        const base = await basename(path);
        const ext = await extname(path);

        const originalFile = findFileInTree(get().files, path);
        if (!originalFile) return;

        const nameWithoutExt = base.slice(0, base.length - ext.length);
        let counter = 0;
        let finalName = "";
        let finalPath = "";

        const generateCopyName = () => {
          if (counter === 0) {
            return `${nameWithoutExt}_copy.${ext}`;
          }
          return `${nameWithoutExt}_copy_${counter}.${ext}`;
        };

        do {
          finalName = generateCopyName();
          finalPath = `${dir}/${finalName}`;
          counter++;
        } while (findFileInTree(get().files, finalPath));

        await copyFile(path, finalPath);

        const newFile: FileEntry = {
          name: finalName,
          path: finalPath,
          isDir: false,
          expanded: false,
        };

        set((state) => {
          state.files = addFileToTree(state.files, dir, newFile);
          state.filesVersion++;
        });
      },

      handleRenamePath: async (path: string, newName?: string) => {
        if (newName) {
          const dir = await dirname(path);

          try {
            const targetPath = await join(dir, newName);
            await renameFile(path, targetPath);

            set((state) => {
              state.files = updateFileInTree(state.files, path, (item) => ({
                ...item,
                name: newName,
                path: targetPath,
                isRenaming: false,
              }));
              state.filesVersion++;
            });

            const { buffers, actions } = useBufferStore.getState();
            const buffer = buffers.find((b) => b.path === path);
            if (buffer) {
              actions.updateBuffer({
                ...buffer,
                path: targetPath,
                name: newName,
              });
            }
          } catch (error) {
            console.error("Failed to rename file:", error);
            set((state) => {
              state.files = updateFileInTree(state.files, path, (item) => ({
                ...item,
                isRenaming: false,
              }));
              state.filesVersion++;
            });
          }
        } else {
          set((state) => {
            state.files = updateFileInTree(state.files, path, (item) => ({
              ...item,
              isRenaming: !item.isRenaming,
            }));
            state.filesVersion++;
          });
        }
      },

      // Setter methods
      setFiles: (newFiles: FileEntry[]) => {
        set((state) => {
          state.files = newFiles;
          state.filesVersion++;
        });
      },
    })),
  ),
);
