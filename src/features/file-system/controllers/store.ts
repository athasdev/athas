import { invoke } from "@tauri-apps/api/core";
import { basename, dirname, extname, join } from "@tauri-apps/api/path";
import { confirm } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { CodeEditorRef } from "@/features/editor/components/code-editor";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-tree-store";
import { useSettingsStore } from "@/features/settings/store";
import { gitDiffCache } from "@/features/version-control/git/controllers/diff-cache";
import {
  isDiffFile,
  parseRawDiffContent,
} from "@/features/version-control/git/controllers/diff-parser";
import { getGitStatus } from "@/features/version-control/git/controllers/git";
import { useGitStore } from "@/features/version-control/git/controllers/store";
import { useGitBlameStore } from "@/stores/git-blame-store";
import { useProjectStore } from "@/stores/project-store";
import { useSearchResultsStore } from "@/stores/search-results-store";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useWorkspaceTabsStore } from "@/stores/workspace-tabs-store";
import { createSelectors } from "@/utils/zustand-selectors";
import type { FileEntry } from "../types/app";
import type { FsActions, FsState } from "../types/interface";
import {
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
  readDirectoryContents,
  readFileContent,
} from "./file-operations";
import {
  addFileToTree,
  findFileInTree,
  removeFileFromTree,
  sortFileEntries,
  updateFileInTree,
} from "./file-tree-utils";
import { getFilenameFromPath, isImageFile, isPdfFile, isSQLiteFile } from "./file-utils";
import { useFileWatcherStore } from "./file-watcher-store";
import { getSymlinkInfo, openFolder, readDirectory, renameFile } from "./platform";
import { useRecentFoldersStore } from "./recent-folders-store";
import { shouldIgnore, updateDirectoryContents } from "./utils";

/**
 * Wraps the file tree with a root folder entry
 */
const wrapWithRootFolder = (
  files: FileEntry[],
  rootPath: string,
  rootName: string,
): FileEntry[] => {
  return [
    {
      name: rootName,
      path: rootPath,
      isDir: true,
      children: files,
    },
  ];
};

export const useFileSystemStore = createSelectors(
  create<FsState & FsActions>()(
    immer((set, get) => ({
      // State
      files: [],
      rootFolderPath: undefined,
      filesVersion: 0,
      isFileTreeLoading: false,
      isSwitchingProject: false,
      isRemoteWindow: false,
      remoteConnectionId: undefined,
      remoteConnectionName: undefined,
      projectFilesCache: undefined,

      // Actions
      handleOpenFolder: async () => {
        const selected = await openFolder();

        set((state) => {
          state.isFileTreeLoading = true;
        });

        if (!selected) {
          set((state) => {
            state.isFileTreeLoading = false;
          });
          return false;
        }

        // Add project to workspace tabs
        const projectName = selected.split("/").pop() || "Project";
        useWorkspaceTabsStore.getState().addProjectTab(selected, projectName);

        const entries = await readDirectoryContents(selected);
        const fileTree = sortFileEntries(entries);
        const wrappedFileTree = wrapWithRootFolder(fileTree, selected, projectName);

        // Initialize tree UI state: expand root
        useFileTreeStore.getState().setExpandedPaths(new Set([selected]));

        // Update project store
        const { setRootFolderPath, setProjectName } = useProjectStore.getState();
        setRootFolderPath(selected);
        setProjectName(projectName);

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
          state.files = wrappedFileTree;
          state.rootFolderPath = selected;
          state.filesVersion++;
          state.projectFilesCache = undefined;
        });

        // Restore session tabs
        await get().restoreSession(selected);

        return true;
      },

      resetWorkspace: async () => {
        // Reset all project-related state to return to welcome screen
        set((state) => {
          state.files = [];
          state.isFileTreeLoading = false;
          state.filesVersion++;
          state.rootFolderPath = undefined;
          state.projectFilesCache = undefined;
        });

        // Clear tree UI state
        useFileTreeStore.getState().collapseAll();

        // Reset project store
        const { setRootFolderPath, setProjectName } = useProjectStore.getState();
        setRootFolderPath("");
        setProjectName("");

        // Close all buffers
        const { buffers, actions: bufferActions } = useBufferStore.getState();
        buffers.forEach((buffer) => bufferActions.closeBuffer(buffer.id));

        // Stop file watching
        await useFileWatcherStore.getState().setProjectRoot("");

        // Reset git store completely
        const { actions: gitActions } = useGitStore.getState();
        gitActions.resetGitState();

        // Clear git diff cache
        gitDiffCache.clear();

        // Clear search results
        useSearchResultsStore.getState().clearSearchResults();
        useSearchResultsStore.getState().clearActivePathSearchResults();

        // Clear git blame data
        useGitBlameStore.getState().clearAllBlame();
      },

      restoreSession: async (projectPath: string) => {
        const session = useSessionStore.getState().getSession(projectPath);
        if (session) {
          const { actions: bufferActions } = useBufferStore.getState();

          // Restore buffers
          for (const buffer of session.buffers) {
            // Use handleFileSelect to open the file (it handles reading content)
            await get().handleFileSelect(buffer.path, false);

            // If it was pinned, we might need to handle that, but handleFileSelect doesn't support pinning arg.
            // We can pin it after opening if needed.
            if (buffer.isPinned) {
              const newBuffers = useBufferStore.getState().buffers;
              const openedBuffer = newBuffers.find((b) => b.path === buffer.path);
              if (openedBuffer) {
                bufferActions.handleTabPin(openedBuffer.id);
              }
            }
          }

          // Restore active buffer
          if (session.activeBufferPath) {
            const { buffers } = useBufferStore.getState();
            const activeBuffer = buffers.find((b) => b.path === session.activeBufferPath);
            if (activeBuffer) {
              useBufferStore.getState().actions.setActiveBuffer(activeBuffer.id);
            }
          }

          // Restore terminals
          if (session.terminals && session.terminals.length > 0) {
            window.dispatchEvent(
              new CustomEvent("restore-terminals", {
                detail: { terminals: session.terminals },
              }),
            );
          }
        }
      },

      closeFolder: async () => {
        // Find the active project tab
        const activeTab = useWorkspaceTabsStore.getState().getActiveProjectTab();

        if (activeTab) {
          // If we have an active tab, close it properly via closeProject
          // This will handle removing the tab and if it's the last one, it will clear the file system
          return await get().closeProject(activeTab.id);
        }

        // Fallback: Reset all project-related state to return to welcome screen
        await get().resetWorkspace();

        return true;
      },

      handleOpenFolderByPath: async (path: string) => {
        set((state) => {
          state.isFileTreeLoading = true;
        });

        // Add project to workspace tabs
        const projectName = path.split("/").pop() || "Project";
        useWorkspaceTabsStore.getState().addProjectTab(path, projectName);

        const entries = await readDirectoryContents(path);
        const fileTree = sortFileEntries(entries);
        const wrappedFileTree = wrapWithRootFolder(fileTree, path, projectName);

        // Clear tree UI state
        useFileTreeStore.getState().collapseAll();

        // Update project store
        const { setRootFolderPath, setProjectName } = useProjectStore.getState();
        setRootFolderPath(path);
        setProjectName(projectName);

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
          state.files = wrappedFileTree;
          state.rootFolderPath = path;
          state.filesVersion++;
          state.projectFilesCache = undefined;
        });

        // Restore session tabs
        await get().restoreSession(path);

        return true;
      },

      handleOpenRemoteProject: async (connectionId: string, connectionName: string) => {
        set((state) => {
          state.isFileTreeLoading = true;
        });

        try {
          // Read remote root directory
          const entries = await invoke<
            Array<{ name: string; path: string; is_dir: boolean; size: number }>
          >("ssh_read_directory", {
            connectionId,
            path: "/",
          });

          // Convert to FileEntry format
          const fileTree: FileEntry[] = entries.map((entry) => ({
            name: entry.name,
            path: `remote://${connectionId}${entry.path}`,
            isDir: entry.is_dir,
            children: entry.is_dir ? [] : undefined,
          }));

          // Create remote root path
          const remotePath = `remote://${connectionId}/`;

          // Add project to workspace tabs
          useWorkspaceTabsStore.getState().addProjectTab(remotePath, connectionName);

          // Wrap with root folder
          const wrappedFileTree: FileEntry[] = [
            {
              name: connectionName,
              path: remotePath,
              isDir: true,
              children: fileTree,
            },
          ];

          // Initialize tree UI state: expand remote root
          useFileTreeStore.getState().setExpandedPaths(new Set([remotePath]));

          // Update project store
          const { setRootFolderPath, setProjectName } = useProjectStore.getState();
          setRootFolderPath(remotePath);
          setProjectName(connectionName);

          set((state) => {
            state.isFileTreeLoading = false;
            state.files = wrappedFileTree;
            state.rootFolderPath = remotePath;
            state.isRemoteWindow = true;
            state.remoteConnectionId = connectionId;
            state.remoteConnectionName = connectionName;
            state.filesVersion++;
            state.projectFilesCache = undefined;
          });

          return true;
        } catch (error) {
          console.error("Failed to open remote project:", error);
          set((state) => {
            state.isFileTreeLoading = false;
          });
          return false;
        }
      },

      handleFileSelect: async (
        path: string,
        isDir: boolean,
        line?: number,
        column?: number,
        codeEditorRef?: React.RefObject<CodeEditorRef | null>,
        isPreview = true,
      ) => {
        const { updateActivePath } = useSidebarStore.getState();

        if (isDir) {
          await get().toggleFolder(path);
          return;
        }

        let resolvedPath = path;

        try {
          const workspaceRoot = get().rootFolderPath;
          const symlinkInfo = await getSymlinkInfo(path, workspaceRoot);

          if (symlinkInfo.is_symlink && symlinkInfo.target) {
            const pathSeparator = path.includes("\\") ? "\\" : "/";
            const pathParts = path.split(pathSeparator);
            pathParts.pop();
            const parentDir = pathParts.join(pathSeparator);

            if (
              symlinkInfo.target.startsWith(pathSeparator) ||
              symlinkInfo.target.match(/^[a-zA-Z]:/)
            ) {
              resolvedPath = symlinkInfo.target;
            } else {
              resolvedPath = workspaceRoot
                ? `${workspaceRoot}${pathSeparator}${symlinkInfo.target}`
                : `${parentDir}${pathSeparator}${symlinkInfo.target}`;
            }
          }
        } catch (error) {
          console.error("Failed to resolve symlink:", error);
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
        if (isSQLiteFile(resolvedPath)) {
          openBuffer(path, fileName, "", false, true, false, false);
        } else if (isImageFile(resolvedPath)) {
          openBuffer(path, fileName, "", true, false, false, false);
        } else if (isPdfFile(resolvedPath)) {
          openBuffer(
            path,
            fileName,
            "",
            false,
            false,
            false,
            false,
            undefined,
            false,
            false,
            false,
            undefined,
            isPreview,
            true,
          );
        } else {
          // Check if external editor is enabled for text files
          const { settings } = useSettingsStore.getState();
          const { openExternalEditorBuffer } = useBufferStore.getState().actions;

          if (settings.externalEditor !== "none") {
            try {
              const { rootFolderPath } = get();

              // Create terminal connection for external editor
              const connectionId = await invoke<string>("create_terminal", {
                config: {
                  working_directory: rootFolderPath || undefined,
                  rows: 24,
                  cols: 80,
                },
              });

              // Open external editor buffer
              openExternalEditorBuffer(resolvedPath, fileName, connectionId);
              return;
            } catch (error) {
              console.error("Failed to create external editor terminal:", error);
            }
          }

          let content: string;

          // Check if this is a remote file
          if (path.startsWith("remote://")) {
            const match = path.match(/^remote:\/\/([^/]+)(\/.*)?$/);
            if (!match) return;

            const connectionId = match[1];
            const remotePath = match[2] || "/";

            content = await invoke<string>("ssh_read_file", {
              connectionId,
              filePath: remotePath,
            });
          } else {
            content = await readFileContent(resolvedPath);
          }

          // Check if this is a diff file
          if (isDiffFile(path, content)) {
            const parsedDiff = parseRawDiffContent(content, path);
            const diffJson = JSON.stringify(parsedDiff);
            openBuffer(path, fileName, diffJson, false, false, true, false);
          } else {
            openBuffer(
              path,
              fileName,
              content,
              false,
              false,
              false,
              false,
              undefined,
              undefined,
              false,
              false,
              undefined,
              isPreview,
            );
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

        // Dispatch go-to-line event to center the line in viewport
        if (line) {
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("menu-go-to-line", {
                detail: { line },
              }),
            );
          }, 100);
        }
      },

      // Open file in definite mode (not preview) - for double-click
      handleFileOpen: async (path: string, isDir: boolean) => {
        await get().handleFileSelect(path, isDir, undefined, undefined, undefined, false);
      },

      toggleFolder: async (path: string) => {
        const folder = findFileInTree(get().files, path);
        if (!folder || !folder.isDir) return;

        const uiStore = useFileTreeStore.getState();
        const isCurrentlyExpanded = uiStore.isExpanded(path);

        if (!isCurrentlyExpanded) {
          // Expand: load children if not present
          if (!folder.children || folder.children.length === 0) {
            let childEntries: FileEntry[];
            const isRemotePath = path.startsWith("remote://");
            if (isRemotePath) {
              const match = path.match(/^remote:\/\/([^/]+)(\/.*)?$/);
              if (!match) return;
              const connectionId = match[1];
              const remotePath = match[2] || "/";
              const entries = await invoke<
                Array<{ name: string; path: string; is_dir: boolean; size: number }>
              >("ssh_read_directory", {
                connectionId,
                path: remotePath,
              });
              childEntries = entries.map((entry) => ({
                name: entry.name,
                path: `remote://${connectionId}${entry.path}`,
                isDir: entry.is_dir,
                children: entry.is_dir ? [] : undefined,
              }));
            } else {
              const entries = await readDirectoryContents(folder.path);
              childEntries = sortFileEntries(entries);
            }

            const updatedFiles = updateFileInTree(get().files, path, (item) => ({
              ...item,
              children: childEntries,
            }));

            set((state) => {
              state.files = updatedFiles;
              state.filesVersion++;
            });
          }
          uiStore.toggleFolder(path);
          // Preload deeper children in background for snappier navigation
          get()
            .preloadSubtree(path, 2, 80)
            .catch(() => {});
        } else {
          // Collapse: only toggle UI state; keep children cached
          uiStore.toggleFolder(path);
        }
      },

      // Preload subtree children up to a depth and directory budget
      preloadSubtree: async (rootPath: string, maxDepth = 2, maxDirs = 80) => {
        const visited = new Set<string>();
        type QueueItem = {
          path: string;
          depth: number;
          isRemote: boolean;
          connectionId?: string;
          remotePath?: string;
        };
        const q: QueueItem[] = [];

        const isRemote = rootPath.startsWith("remote://");
        let connectionId: string | undefined;
        let remoteRoot: string | undefined;
        if (isRemote) {
          const match = rootPath.match(/^remote:\/\/([^/]+)(\/.*)?$/);
          if (match) {
            connectionId = match[1];
            remoteRoot = match[2] || "/";
          }
        }

        q.push({ path: rootPath, depth: 0, isRemote, connectionId, remotePath: remoteRoot });
        let processed = 0;

        while (q.length && processed < maxDirs) {
          const batch = q.splice(0, 8);
          await Promise.all(
            batch.map(async (item) => {
              if (visited.has(item.path) || item.depth >= maxDepth) return;
              visited.add(item.path);
              processed++;

              try {
                // Skip if children already present
                const node = findFileInTree(get().files, item.path);
                if (!node || !node.isDir) return;
                if (node.children && node.children.length > 0) {
                  // Still enqueue subdirs to continue traversal
                  node.children
                    ?.filter((c) => c.isDir)
                    .forEach((c) =>
                      q.push({
                        path: c.path,
                        depth: item.depth + 1,
                        isRemote: c.path.startsWith("remote://"),
                        connectionId: item.connectionId,
                        remotePath: c.path.replace(/^remote:\/\/[^/]+/, ""),
                      }),
                    );
                  return;
                }

                let entries: Array<{ name: string; path: string; is_dir: boolean }>;
                if (item.isRemote && item.connectionId) {
                  const rp = item.remotePath || "/";
                  const res = await invoke<
                    Array<{ name: string; path: string; is_dir: boolean; size: number }>
                  >("ssh_read_directory", {
                    connectionId: item.connectionId,
                    path: rp,
                  });
                  entries = res.map((e) => ({
                    name: e.name,
                    path: `remote://${item.connectionId}${e.path}`,
                    is_dir: e.is_dir,
                  }));
                } else {
                  const res = await readDirectoryContents(item.path);
                  entries = res.map((e) => ({ name: e.name, path: e.path, is_dir: e.isDir }));
                }

                const children: FileEntry[] = sortFileEntries(
                  entries.map((e) => ({
                    name: e.name,
                    path: e.path,
                    isDir: e.is_dir,
                    children: e.is_dir ? [] : undefined,
                  })) as any,
                );

                set((state) => {
                  state.files = updateFileInTree(state.files, item.path, (it) => ({
                    ...it,
                    children,
                  }));
                  state.filesVersion++;
                });

                // Enqueue subdirs
                children
                  .filter((c) => c.isDir)
                  .forEach((c) =>
                    q.push({
                      path: c.path,
                      depth: item.depth + 1,
                      isRemote: c.path.startsWith("remote://"),
                      connectionId: item.connectionId,
                      remotePath: c.path.replace(/^remote:\/\/[^/]+/, ""),
                    }),
                  );
              } catch {}
            }),
          );

          // Yield to UI
          await new Promise((r) => setTimeout(r, 0));
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
        // Split the input path into parts
        const parts = fileName.split("/").filter(Boolean);
        // Validate input
        if (parts.length === 0) {
          alert("Invalid file name");
          return;
        }

        const finalFileName = parts.pop()!;

        // Block path traversal and illegal separators
        const hasIllegalCharacters = (segment: string) =>
          segment === ".." || segment === "." || segment.includes("\\") || segment.includes("/");

        // Check all directory parts AND the final filename
        if (parts.some(hasIllegalCharacters) || hasIllegalCharacters(finalFileName)) {
          alert("Invalid file name: path traversal and special characters are not allowed");
          return;
        }

        let currentPath = dirPath;
        // Create intermediate folders if they don't exist
        try {
          for (const folder of parts) {
            const potentialPath = await join(currentPath, folder);
            // Check if directory already exists in the file tree
            const existingFolder = findFileInTree(get().files, potentialPath);

            if (existingFolder?.isDir) {
              // Directory already exists, just use its path
              currentPath = potentialPath;
            } else {
              // Create the directory if it doesn't exist
              currentPath = await get().createDirectory(currentPath, folder);
            }
          }
          // Finally create the file inside the deepest folder
          return await get().createFile(currentPath, finalFileName);
        } catch (error) {
          console.error("Failed to create nested file:", error);
          alert(
            `Failed to create file: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
          return;
        }
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

        if (!dirNode || !dirNode.isDir) {
          return;
        }

        // Check if directory is expanded using the file tree store
        // Root folder is always considered expanded since it's always visible
        const isRoot = directoryPath === get().rootFolderPath;
        const isExpanded = isRoot || useFileTreeStore.getState().isExpanded(directoryPath);

        if (!isExpanded) {
          return;
        }

        const entries = await readDirectory(directoryPath);

        set((state) => {
          const updated = updateDirectoryContents(state.files, directoryPath, entries as any[]);

          if (updated) {
            state.filesVersion++;
          }
        });
      },

      handleCollapseAllFolders: async () => {
        // Only collapse UI, do not mutate file data
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

        // If we have cached files for this path (even if old), return them and update in background
        const hasCachedFiles = projectFilesCache?.files && projectFilesCache.files.length > 0;

        const scanFiles = async () => {
          try {
            const allFiles: FileEntry[] = [];
            let processedFiles = 0;
            const maxFiles = useSettingsStore.getState().settings.commandBarFileLimit;

            const scanDirectory = async (
              directoryPath: string,
              depth: number = 0,
            ): Promise<boolean> => {
              // Prevent infinite recursion and very deep scanning
              if (depth > 8 || processedFiles > maxFiles) {
                return false; // Signal to stop scanning
              }

              try {
                const entries = await readDirectory(directoryPath);

                for (const entry of entries as any[]) {
                  if (processedFiles > maxFiles) break;

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
        };

        // If we don't have cached files, wait for the scan to complete
        if (!hasCachedFiles) {
          await scanFiles();
          return get().projectFilesCache?.files || [];
        }

        // Otherwise, return cached files and update in background
        setTimeout(scanFiles, 0);
        return projectFilesCache?.files || [];
      },

      createFile: async (directoryPath: string, fileName: string) => {
        const filePath = await createNewFile(directoryPath, fileName);

        const newFile: FileEntry = {
          name: fileName,
          path: filePath,
          isDir: false,
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

      setIsSwitchingProject: (value: boolean) => {
        set((state) => {
          state.isSwitchingProject = value;
        });
      },

      switchToProject: async (projectId: string) => {
        const tab = useWorkspaceTabsStore
          .getState()
          .projectTabs.find((t: { id: string }) => t.id === projectId);

        if (!tab) {
          console.warn(`Project tab not found: ${projectId}`);
          return false;
        }

        // Set switching flag to prevent tab bar from hiding
        set((state) => {
          state.isSwitchingProject = true;
          state.isFileTreeLoading = true;
        });

        // Save current project's session before switching
        const currentRootPath = get().rootFolderPath;
        if (currentRootPath) {
          const { buffers, activeBufferId } = useBufferStore.getState();
          const activeBuffer = buffers.find((b) => b.id === activeBufferId);
          useSessionStore.getState().saveSession(
            currentRootPath,
            buffers.map((b) => ({
              id: b.id,
              name: b.name,
              path: b.path,
              isPinned: b.isPinned,
            })),
            activeBuffer?.path || null,
          );

          const { actions: bufferActions } = useBufferStore.getState();
          bufferActions.closeBuffersBatch(
            buffers.map((b) => b.id),
            true,
          );
        }

        // Load new project's file tree
        const entries = await readDirectoryContents(tab.path);
        const fileTree = sortFileEntries(entries);
        const wrappedFileTree = wrapWithRootFolder(fileTree, tab.path, tab.name);

        // Initialize tree UI state: expand root
        useFileTreeStore.getState().setExpandedPaths(new Set([tab.path]));

        // Update project store
        const { setRootFolderPath, setProjectName, setActiveProjectId } =
          useProjectStore.getState();
        setRootFolderPath(tab.path);
        setProjectName(tab.name);
        setActiveProjectId(projectId);

        // Update workspace tabs
        useWorkspaceTabsStore.getState().setActiveProjectTab(projectId);

        // Start file watching
        await useFileWatcherStore.getState().setProjectRoot(tab.path);

        // Initialize git status
        const gitStatus = await getGitStatus(tab.path);
        useGitStore.getState().actions.setGitStatus(gitStatus);

        // Clear git diff cache for new project
        gitDiffCache.clear();

        set((state) => {
          state.isFileTreeLoading = false;
          state.files = wrappedFileTree;
          state.rootFolderPath = tab.path;
          state.filesVersion++;
          state.projectFilesCache = undefined;
        });

        // Restore session tabs for this project
        await get().restoreSession(tab.path);

        // Clear switching flag
        set((state) => {
          state.isSwitchingProject = false;
        });

        return true;
      },

      closeProject: async (projectId: string) => {
        const tabs = useWorkspaceTabsStore.getState().projectTabs;

        const tab = tabs.find((t: { id: string }) => t.id === projectId);
        if (!tab) {
          console.warn(`Project tab not found: ${projectId}`);
          return false;
        }

        const wasActive = tab.isActive;
        const isLastTab = tabs.length <= 1;

        // Save session before closing if it's the active project
        if (wasActive) {
          const { buffers, activeBufferId } = useBufferStore.getState();
          const activeBuffer = buffers.find((b) => b.id === activeBufferId);

          // Get current terminals from local storage (temporary persistence)
          let terminals: any[] = [];
          try {
            const storedTerminals = localStorage.getItem("terminal-sessions");
            if (storedTerminals) {
              terminals = JSON.parse(storedTerminals);
            }
          } catch (e) {
            console.error("Failed to read terminal sessions", e);
          }

          useSessionStore.getState().saveSession(
            tab.path,
            buffers.map((b) => ({
              id: b.id,
              name: b.name,
              path: b.path,
              isPinned: b.isPinned,
            })),
            activeBuffer?.path || null,
            terminals,
          );
        }

        // Remove project tab
        useWorkspaceTabsStore.getState().removeProjectTab(projectId);

        // If this was the last tab, reset to empty state
        if (isLastTab) {
          // Stop file watching
          useFileWatcherStore.getState().reset();

          // Clear all buffers
          const { buffers } = useBufferStore.getState();
          const allBufferIds = buffers.map((b) => b.id);
          useBufferStore.getState().actions.closeBuffersBatch(allBufferIds, true);

          // Clear git state
          const gitActions = useGitStore.getState().actions;
          gitActions.setGitStatus(null);
          gitActions.resetCommits();

          // Clear project store
          const { setRootFolderPath, setProjectName } = useProjectStore.getState();
          setRootFolderPath(undefined);
          setProjectName("Explorer");

          // Reset file system state
          set((state) => {
            state.files = [];
            state.rootFolderPath = undefined;
            state.filesVersion = 0;
          });

          return true;
        }

        // If we closed the active project, switch to the newly active one
        if (wasActive) {
          const newActiveTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
          if (newActiveTab) {
            await get().switchToProject(newActiveTab.id);
          } else {
            // If no active tab (we closed the last one), clear the workspace
            await get().resetWorkspace();
          }
        }

        return true;
      },
    })),
  ),
);
