import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { FileEntry } from "../types/app";
import {
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
  readDirectoryContents,
  readFileContent,
} from "../utils/file-operations";
import { addFileToTree, removeFileFromTree, sortFileEntries } from "../utils/file-tree-utils";
import { getFilenameFromPath, isImageFile, isSQLiteFile } from "../utils/file-utils";
import { isDiffFile, parseRawDiffContent } from "../utils/git-diff-parser";
import { openFolder } from "../utils/platform";

interface FileSystemActionsState {
  isFileTreeLoading: boolean;
}

export const useFileSystemActions = create(
  immer(
    combine(
      {
        isFileTreeLoading: false,
      } as FileSystemActionsState,
      set => ({
        handleOpenFolder: async () => {
          try {
            set(state => {
              state.isFileTreeLoading = true;
            });

            const selected = await openFolder();

            if (selected) {
              const entries = await readDirectoryContents(selected);
              const fileTree = sortFileEntries(entries);

              set(state => {
                state.isFileTreeLoading = false;
              });

              // Import stores dynamically to avoid circular dependencies
              const { useFileSystemStore } = await import("./file-system-store");
              const { useProjectStore } = await import("./project-store");
              const { useFileWatcherStore } = await import("./file-watcher-store");
              const { useRecentFoldersStore } = await import("./recent-folders-store");
              const { useFileTreeStore } = await import("./file-tree-store");

              // Update file system store
              const fileSystemStore = useFileSystemStore.getState();
              fileSystemStore.setFiles(fileTree);
              fileSystemStore.setRootFolderPath(selected);
              fileSystemStore.clearProjectFilesCache();

              // Clear tree UI state
              useFileTreeStore.getState().collapseAll();

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
            } else {
              set(state => {
                state.isFileTreeLoading = false;
              });
              return false;
            }
          } catch (error) {
            console.error("Error opening folder:", error);
            set(state => {
              state.isFileTreeLoading = false;
            });
            return false;
          }
        },

        handleOpenFolderByPath: async (path: string) => {
          try {
            set(state => {
              state.isFileTreeLoading = true;
            });

            const entries = await readDirectoryContents(path);
            const fileTree = sortFileEntries(entries);

            set(state => {
              state.isFileTreeLoading = false;
            });

            // Import stores dynamically
            const { useFileSystemStore } = await import("./file-system-store");
            const { useProjectStore } = await import("./project-store");
            const { useFileWatcherStore } = await import("./file-watcher-store");
            const { useRecentFoldersStore } = await import("./recent-folders-store");
            const { useFileTreeStore } = await import("./file-tree-store");

            // Update file system store
            const fileSystemStore = useFileSystemStore.getState();
            fileSystemStore.setFiles(fileTree);
            fileSystemStore.setRootFolderPath(path);
            fileSystemStore.clearProjectFilesCache();

            // Clear tree UI state
            useFileTreeStore.getState().collapseAll();

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
            set(state => {
              state.isFileTreeLoading = false;
            });
            return false;
          }
        },

        handleFileSelect: async (
          path: string,
          isDir: boolean,
          options?: {
            line?: number;
            column?: number;
            codeEditorRef?: any;
            vimEnabled?: boolean;
            setVimMode?: (mode: string) => void;
            updateCursorPosition?: () => void;
          },
        ) => {
          if (isDir) return;

          const fileName = getFilenameFromPath(path);
          const { useBufferStore } = await import("./buffer-store");
          const { openBuffer } = useBufferStore.getState();

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
            openBuffer(path, fileName, "", true, false, false, false);
          } else if (isImageFile(path)) {
            openBuffer(path, fileName, "", false, true, false, false);
          } else {
            try {
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
              if (options?.line && options?.column && options?.codeEditorRef?.current?.textarea) {
                requestAnimationFrame(() => {
                  if (options.codeEditorRef.current?.textarea) {
                    const textarea = options.codeEditorRef.current.textarea;
                    const lines = content.split("\n");
                    let targetPosition = 0;

                    if (options.line) {
                      for (let i = 0; i < options.line - 1 && i < lines.length; i++) {
                        targetPosition += lines[i].length + 1;
                      }
                      if (options.column) {
                        targetPosition += Math.min(
                          options.column - 1,
                          lines[options.line - 1]?.length || 0,
                        );
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
                    const scrollTop = options.line
                      ? Math.max(0, (options.line - 1) * lineHeight - textarea.clientHeight / 2)
                      : 0;
                    textarea.scrollTop = scrollTop;
                  }
                });
              }

              // Reset vim mode
              if (options?.vimEnabled && options?.setVimMode && options?.updateCursorPosition) {
                options.setVimMode("normal" as any);
                requestAnimationFrame(() => {
                  options.updateCursorPosition?.();
                });
              }
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

        createFile: async (directoryPath: string, fileName: string) => {
          try {
            const filePath = await createNewFile(directoryPath, fileName);

            // Update file tree
            const { useFileSystemStore } = await import("./file-system-store");
            const fileSystemStore = useFileSystemStore.getState();
            const newFile: FileEntry = {
              name: fileName,
              path: filePath,
              isDir: false,
              expanded: false,
            };

            const updatedFiles = addFileToTree(fileSystemStore.files, directoryPath, newFile);

            fileSystemStore.setFiles(updatedFiles);

            return filePath;
          } catch (error) {
            console.error("Error creating file:", error);
            throw error;
          }
        },

        createDirectory: async (parentPath: string, folderName: string) => {
          try {
            const folderPath = await createNewDirectory(parentPath, folderName);

            // Update file tree
            const { useFileSystemStore } = await import("./file-system-store");
            const fileSystemStore = useFileSystemStore.getState();
            const newFolder: FileEntry = {
              name: folderName,
              path: folderPath,
              isDir: true,
              expanded: false,
              children: [],
            };

            const updatedFiles = addFileToTree(fileSystemStore.files, parentPath, newFolder);
            fileSystemStore.setFiles(updatedFiles);

            return folderPath;
          } catch (error) {
            console.error("Error creating directory:", error);
            throw error;
          }
        },

        deleteFile: async (path: string) => {
          try {
            await deleteFileOrDirectory(path);

            // Update file tree
            const { useFileSystemStore } = await import("./file-system-store");
            const fileSystemStore = useFileSystemStore.getState();
            const updatedFiles = removeFileFromTree(fileSystemStore.files, path);
            fileSystemStore.setFiles(updatedFiles);

            // Close any open buffers for this file
            const { useBufferStore } = await import("./buffer-store");
            const { buffers, closeBuffer } = useBufferStore.getState();

            // Find and close any buffers with matching path
            const buffersToClose = buffers.filter(buffer => buffer.path === path);
            buffersToClose.forEach(buffer => {
              closeBuffer(buffer.id);
            });
          } catch (error) {
            console.error("Error deleting file:", error);
            throw error;
          }
        },
      }),
    ),
  ),
);
