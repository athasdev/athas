# App.tsx Refactoring Plan: Zustand Store Migration

## Overview

This document outlines a 3-step plan to refactor App.tsx from 1528 lines to ~200 lines by
leveraging Zustand stores to eliminate prop drilling, fix performance issues, and improve
maintainability.

## Current Problems

1. **Performance**:
   Every keystroke causes full App component re-render due to callback recreation
2. **Prop Drilling**:
   CodeEditor receives 23+ props, MainSidebar receives 12+ props
3. **Memory Leaks Risk**:
   17 useEffect hooks with complex dependencies
4. **Testing Nightmare**:
   28 event handlers that can't be tested in isolation
5. **State Chaos**:
   Mix of local state, custom hooks, and store state with duplications

---

## Step 1: Core Editor & Buffer Store

### Goal

Consolidate all editor operations, buffer management, and tab handling into unified stores.

### Files to Create/Modify

1. `src/stores/app-store.ts` (new) - Editor operations, autosave, quick edit
2. `src/stores/buffer-store.ts` (enhance existing) - Buffer/tab management

### Implementation Details

```typescript
// src/stores/app-store.ts
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { readFile, writeFile } from "../utils/platform";

interface AppState {
  // Autosave state
  autoSaveTimeoutId: NodeJS.Timeout | null;

  // Quick edit state
  quickEditState: {
    isOpen: boolean;
    selectedText: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  };
}

export const useAppStore = create(
  immer(
    combine(
      {
        autoSaveTimeoutId: null,
        quickEditState: {
          isOpen: false,
          selectedText: "",
          cursorPosition: { x: 0, y: 0 },
          selectionRange: { start: 0, end: 0 },
        },
      } as AppState,
      (set, get) => ({
        // Content change handler - no more recreation on every render!
        handleContentChange: async (content: string) => {
          // Get dependencies from other stores
          const { activeBufferId, updateBufferContent, markBufferDirty } = useBufferStore.getState();
          const { autoSave } = usePersistentSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = useBufferStore.getState().buffers.find((b) => b.id === activeBufferId);
          if (!activeBuffer) return;

          const isRemoteFile = activeBuffer.path.startsWith("remote://");

          if (isRemoteFile) {
            updateBufferContent(activeBuffer.id, content, false);
          } else {
            updateBufferContent(activeBuffer.id, content, true);

            // Handle autosave
            if (!activeBuffer.isVirtual && autoSave) {
              // Clear existing timeout
              const { autoSaveTimeoutId } = get();
              if (autoSaveTimeoutId) {
                clearTimeout(autoSaveTimeoutId);
              }

              // Set new timeout
              const newTimeoutId = setTimeout(async () => {
                try {
                  markPendingSave(activeBuffer.path);
                  await writeFile(activeBuffer.path, content);
                  markBufferDirty(activeBuffer.id, false);
                } catch (error) {
                  console.error("Error saving file:", error);
                  markBufferDirty(activeBuffer.id, true);
                }
              }, 150);

              set((state) => {
                state.autoSaveTimeoutId = newTimeoutId;
              });
            }
          }
        },

        // Save handler
        handleSave: async () => {
          const { activeBufferId, markBufferDirty, updateBufferContent } = useBufferStore.getState();
          const { updateSettingsFromJSON } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = useBufferStore.getState().buffers.find((b) => b.id === activeBufferId);
          if (!activeBuffer) return;

          if (activeBuffer.isVirtual) {
            if (activeBuffer.path === "settings://user-settings.json") {
              const success = updateSettingsFromJSON(activeBuffer.content);
              markBufferDirty(activeBuffer.id, !success);
            } else {
              markBufferDirty(activeBuffer.id, false);
            }
          } else if (activeBuffer.path.startsWith("remote://")) {
            // Handle remote save
            markBufferDirty(activeBuffer.id, true);
            const pathParts = activeBuffer.path.replace("remote://", "").split("/");
            const connectionId = pathParts.shift();
            const remotePath = `/${pathParts.join("/")}`;

            if (connectionId) {
              try {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("ssh_write_file", {
                  connectionId,
                  filePath: remotePath,
                  content: activeBuffer.content,
                });
                markBufferDirty(activeBuffer.id, false);
              } catch (error) {
                console.error("Error saving remote file:", error);
                markBufferDirty(activeBuffer.id, true);
              }
            }
          } else {
            // Handle local save
            try {
              markPendingSave(activeBuffer.path);
              await writeFile(activeBuffer.path, activeBuffer.content);
              markBufferDirty(activeBuffer.id, false);
            } catch (error) {
              console.error("Error saving local file:", error);
              markBufferDirty(activeBuffer.id, true);
            }
          }
        },

        // Quick edit handlers
        openQuickEdit: (params: { text: string; cursorPosition: { x: number; y: number }; selectionRange: { start: number; end: number } }) => {
          set((state) => {
            state.quickEditState = {
              isOpen: true,
              selectedText: params.text,
              cursorPosition: params.cursorPosition,
              selectionRange: params.selectionRange,
            };
          });
        },

        closeQuickEdit: () => {
          set((state) => {
            state.quickEditState.isOpen = false;
          });
        },

        // Cleanup
        cleanup: () => {
          const { autoSaveTimeoutId } = get();
          if (autoSaveTimeoutId) {
            clearTimeout(autoSaveTimeoutId);
          }
        },
      }),
    ),
  ),
);

// Enhanced buffer-store.ts
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { v4 as uuidv4 } from "uuid";

interface Buffer {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  isVirtual: boolean;
  isPinned: boolean;
  isImage?: boolean;
  isSQLite?: boolean;
  isDiff?: boolean;
}

interface BufferState {
  buffers: Buffer[];
  activeBufferId: string | null;
  maxOpenTabs: number;
}

export const useBufferStore = create(
  immer(
    combine(
      {
        buffers: [],
        activeBufferId: null,
        maxOpenTabs: 10,
      } as BufferState,
      (set, get) => ({
        // Core buffer operations
        openBuffer: (path: string, name: string, content: string, isImage = false, isSQLite = false, isDiff = false, isVirtual = false) => {
          const { buffers, maxOpenTabs } = get();

          // Check if already open
          const existing = buffers.find((b) => b.path === path);
          if (existing) {
            set((state) => {
              state.activeBufferId = existing.id;
            });
            return existing.id;
          }

          // Handle max tabs limit
          let newBuffers = [...buffers];
          if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
            const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
            const lruBuffer = unpinnedBuffers[0]; // Simplified LRU
            newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
          }

          const newBuffer: Buffer = {
            id: uuidv4(),
            path,
            name,
            content,
            isDirty: false,
            isVirtual,
            isPinned: false,
            isImage,
            isSQLite,
            isDiff,
          };

          set((state) => {
            state.buffers = [...newBuffers, newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          return newBuffer.id;
        },

        closeBuffer: (bufferId: string) => {
          const { buffers, activeBufferId } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);

          if (bufferIndex === -1) return;

          const newBuffers = buffers.filter((b) => b.id !== bufferId);
          let newActiveId = activeBufferId;

          if (activeBufferId === bufferId) {
            if (newBuffers.length > 0) {
              // Select next or previous buffer
              const newIndex = Math.min(bufferIndex, newBuffers.length - 1);
              newActiveId = newBuffers[newIndex].id;
            } else {
              newActiveId = null;
            }
          }

          set((state) => {
            state.buffers = newBuffers;
            state.activeBufferId = newActiveId;
          });
        },

        setActiveBuffer: (bufferId: string) => {
          set((state) => {
            state.activeBufferId = bufferId;
          });
        },

        updateBufferContent: (bufferId: string, content: string, markDirty = true) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.content = content;
              if (markDirty && !buffer.isVirtual) {
                buffer.isDirty = true;
              }
            }
          });
        },

        markBufferDirty: (bufferId: string, isDirty: boolean) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.isDirty = isDirty;
            }
          });
        },

        updateBuffer: (updatedBuffer: Buffer) => {
          set((state) => {
            const index = state.buffers.findIndex((b) => b.id === updatedBuffer.id);
            if (index !== -1) {
              state.buffers[index] = updatedBuffer;
            }
          });
        },

        // Tab operations - all in one place!
        handleTabClick: (bufferId: string) => {
          set((state) => {
            state.activeBufferId = bufferId;
          });
        },

        handleTabClose: (bufferId: string) => {
          get().closeBuffer(bufferId);
        },

        handleTabPin: (bufferId: string) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.isPinned = !buffer.isPinned;
            }
          });
        },

        handleCloseOtherTabs: (keepBufferId: string) => {
          const { buffers } = get();
          const buffersToClose = buffers.filter((b) => b.id !== keepBufferId && !b.isPinned);
          buffersToClose.forEach((buffer) => get().closeBuffer(buffer.id));
        },

        handleCloseAllTabs: () => {
          const { buffers } = get();
          const buffersToClose = buffers.filter((b) => !b.isPinned);
          buffersToClose.forEach((buffer) => get().closeBuffer(buffer.id));
        },

        handleCloseTabsToRight: (bufferId: string) => {
          const { buffers } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);
          if (bufferIndex === -1) return;

          const buffersToClose = buffers.slice(bufferIndex + 1).filter((b) => !b.isPinned);
          buffersToClose.forEach((buffer) => get().closeBuffer(buffer.id));
        },

        reorderBuffers: (startIndex: number, endIndex: number) => {
          set((state) => {
            const result = Array.from(state.buffers);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            state.buffers = result;
          });
        },

        // Navigation
        switchToNextBuffer: () => {
          const { buffers, activeBufferId } = get();
          if (buffers.length === 0) return;

          const currentIndex = buffers.findIndex((b) => b.id === activeBufferId);
          const nextIndex = (currentIndex + 1) % buffers.length;
          set((state) => {
            state.activeBufferId = buffers[nextIndex].id;
          });
        },

        switchToPreviousBuffer: () => {
          const { buffers, activeBufferId } = get();
          if (buffers.length === 0) return;

          const currentIndex = buffers.findIndex((b) => b.id === activeBufferId);
          const prevIndex = (currentIndex - 1 + buffers.length) % buffers.length;
          set((state) => {
            state.activeBufferId = buffers[prevIndex].id;
          });
        },

        // Helpers
        getActiveBuffer: () => {
          const { buffers, activeBufferId } = get();
          return buffers.find((b) => b.id === activeBufferId);
        },

        setMaxOpenTabs: (max: number) => {
          set((state) => {
            state.maxOpenTabs = max;
          });
        },
      }),
    ),
  ),
);
```

### Migration Tasks

1. Create the app store with editor operations
2. Enhance the existing buffer store with all tab operations
3. Move content change handler from App.tsx to app store
4. Move save handler from App.tsx to app store
5. Move quick edit state and handlers to app store
6. Move all tab handlers to buffer store
7. Update components to use store methods directly

### Testing Points

- Verify autosave functionality
- Test save for local, remote, and virtual files
- Ensure tab operations work correctly
- Check that performance improves (no re-renders on keystrokes)
- Verify quick edit modal functionality

---

## Step 2: File System & Project Store

### Goal

Unify all file system operations, folder management, and project state into coherent stores.

### Files to Create/Modify

1. `src/stores/file-system-store.ts` (new) - All file operations
2. Enhance existing `project-store.ts` - Project-specific state
3. Remove hooks: `use-file-operations.ts`, `use-folder-operations.ts`, `use-file-selection.ts`

### Implementation Details

```typescript
// src/stores/file-system-store.ts
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { readDirectory, createFile, createFolder, deleteFile, readFile } from "../utils/platform";
import { getLanguageFromFilename } from "../utils/file-utils";

interface FileSystemState {
  files: FileEntry[];
  rootFolderPath: string | null;
  expandedFolders: Set<string>;
  selectedFiles: Set<string>;

  // Remote connection state
  isRemoteWindow: boolean;
  remoteConnectionId: string | null;
  remoteConnectionName: string | null;
}

export const useFileSystemStore = create(
  immer(
    combine(
      {
        files: [],
        rootFolderPath: null,
        expandedFolders: new Set<string>(),
        selectedFiles: new Set<string>(),
        isRemoteWindow: false,
        remoteConnectionId: null,
        remoteConnectionName: null,
      } as FileSystemState,
      (set, get) => ({
        // Folder operations
        handleOpenFolder: async () => {
          try {
            const { open } = await import("@tauri-apps/api/dialog");
            const selected = await open({
              directory: true,
              multiple: false,
              title: "Select a folder to open",
            });

            if (selected && typeof selected === "string") {
              await get().loadFolderContents(selected);
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
            await get().loadFolderContents(path);
            return true;
          } catch (error) {
            console.error("Error opening folder by path:", error);
            return false;
          }
        },

        loadFolderContents: async (path: string) => {
          try {
            const files = await readDirectory(path);
            set((state) => {
              state.rootFolderPath = path;
              state.files = files;
              state.expandedFolders = new Set<string>();
            });

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
        handleFileSelect: async (path: string, isDir: boolean) => {
          if (isDir) {
            get().toggleFolder(path);
          } else {
            const { openBuffer } = useBufferStore.getState();
            const fileName = path.split("/").pop() || "Untitled";

            try {
              const content = await readFile(path);
              const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(path);
              const isSQLite = /\.(db|sqlite|sqlite3)$/i.test(path);

              openBuffer(path, fileName, content, isImage, isSQLite, false, false);

              // Open document in LSP if supported
              const { openDocument, isLanguageSupported } = useLSPStore.getState();
              const language = getLanguageFromFilename(fileName);
              if (isLanguageSupported(language)) {
                openDocument(path, content, language);
              }
            } catch (error) {
              console.error("Error reading file:", error);
            }
          }
        },

        toggleFolder: (path: string) => {
          set((state) => {
            const expanded = new Set(state.expandedFolders);
            if (expanded.has(path)) {
              expanded.delete(path);
            } else {
              expanded.add(path);
              // Load folder contents if needed
              get().loadFolderContentsIfNeeded(path);
            }
            state.expandedFolders = expanded;
          });
        },

        handleCreateNewFile: async () => {
          const { rootFolderPath } = get();
          if (!rootFolderPath) return;

          const fileName = prompt("Enter file name:");
          if (!fileName) return;

          try {
            const filePath = `${rootFolderPath}/${fileName}`;
            await createFile(filePath, "");
            await get().refreshDirectory(rootFolderPath);

            // Open the new file
            await get().handleFileSelect(filePath, false);
          } catch (error) {
            console.error("Error creating file:", error);
          }
        },

        handleCreateNewFileInDirectory: async (dirPath: string) => {
          const fileName = prompt("Enter file name:");
          if (!fileName) return;

          try {
            const filePath = `${dirPath}/${fileName}`;
            await createFile(filePath, "");
            await get().refreshDirectory(dirPath);
            await get().handleFileSelect(filePath, false);
          } catch (error) {
            console.error("Error creating file:", error);
          }
        },

        handleCreateNewFolderInDirectory: async (dirPath: string) => {
          const folderName = prompt("Enter folder name:");
          if (!folderName) return;

          try {
            const folderPath = `${dirPath}/${folderName}`;
            await createFolder(folderPath);
            await get().refreshDirectory(dirPath);
          } catch (error) {
            console.error("Error creating folder:", error);
          }
        },

        handleDeletePath: async (path: string) => {
          const confirmed = confirm(`Delete ${path}?`);
          if (!confirmed) return;

          try {
            await deleteFile(path);
            const parentDir = path.substring(0, path.lastIndexOf("/"));
            await get().refreshDirectory(parentDir);

            // Close buffer if file is open
            const { buffers, closeBuffer } = useBufferStore.getState();
            const buffer = buffers.find((b) => b.path === path);
            if (buffer) {
              closeBuffer(buffer.id);
            }
          } catch (error) {
            console.error("Error deleting path:", error);
          }
        },

        refreshDirectory: async (dirPath: string) => {
          try {
            const updatedContents = await readDirectory(dirPath);
            set((state) => {
              updateFileTree(state.files, dirPath, updatedContents);
            });
          } catch (error) {
            console.error("Error refreshing directory:", error);
          }
        },

        handleCollapseAllFolders: () => {
          set((state) => {
            state.expandedFolders = new Set<string>();
          });
        },

        // Remote operations
        setRemoteConnection: (connectionId: string | null, connectionName: string | null) => {
          set((state) => {
            state.isRemoteWindow = !!connectionId;
            state.remoteConnectionId = connectionId;
            state.remoteConnectionName = connectionName;
          });
        },

        handleRemoteFileSelect: async (path: string, isDir: boolean) => {
          if (!get().remoteConnectionId) return;

          if (isDir) {
            // Handle remote folder toggle
            await get().handleRemoteFolderToggle(path);
          } else {
            // Handle remote file open
            const { openBuffer } = useBufferStore.getState();
            const fileName = path.split("/").pop() || "Untitled";
            const remotePath = `remote://${get().remoteConnectionId}${path}`;

            try {
              const { invoke } = await import("@tauri-apps/api/core");
              const content = await invoke<string>("ssh_read_file", {
                connectionId: get().remoteConnectionId,
                filePath: path,
              });

              openBuffer(remotePath, fileName, content, false, false, false, false);
            } catch (error) {
              console.error("Error reading remote file:", error);
            }
          }
        },

        handleRemoteFolderToggle: async (path: string) => {
          // Implementation for remote folder operations
          set((state) => {
            const expanded = new Set(state.expandedFolders);
            if (expanded.has(path)) {
              expanded.delete(path);
            } else {
              expanded.add(path);
            }
            state.expandedFolders = expanded;
          });
        },

        // File move/rename
        handleFileMove: async (oldPath: string, newPath: string) => {
          try {
            // Update file system
            await moveFile(oldPath, newPath);

            // Refresh directories
            const oldDir = oldPath.substring(0, oldPath.lastIndexOf("/"));
            const newDir = newPath.substring(0, newPath.lastIndexOf("/"));
            await get().refreshDirectory(oldDir);
            if (oldDir !== newDir) {
              await get().refreshDirectory(newDir);
            }

            // Update open buffers
            const { buffers, updateBuffer } = useBufferStore.getState();
            const buffer = buffers.find((b) => b.path === oldPath);
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
        getAllProjectFiles: async () => {
          const { rootFolderPath } = get();
          if (!rootFolderPath) return [];

          const allFiles: string[] = [];
          const scanDirectory = async (dir: string) => {
            const contents = await readDirectory(dir);
            for (const entry of contents) {
              if (entry.isDirectory) {
                await scanDirectory(entry.path);
              } else {
                allFiles.push(entry.path);
              }
            }
          };

          await scanDirectory(rootFolderPath);
          return allFiles;
        },

        loadFolderContentsIfNeeded: async (path: string) => {
          // Implementation to lazily load folder contents
          const { files } = get();
          const folder = findFileEntry(files, path);
          if (folder && folder.isDirectory && !folder.children) {
            const contents = await readDirectory(path);
            set((state) => {
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
```

### Migration Tasks

1. Create the file system store
2. Remove file operation hooks from App.tsx
3. Integrate remote connection handling into the store
4. Update file tree component to use store directly
5. Migrate file watcher integration
6. Update drag-and-drop handlers to use store methods
7. Remove all file-related state and handlers from App.tsx

### Testing Points

- File/folder creation and deletion
- File tree navigation and expansion
- Drag and drop file operations
- Remote file handling
- File watcher integration
- Search functionality
- Lazy loading of folder contents

---

## Step 3: Component Migration & Cleanup

### Goal

Update all components to use stores directly and create the final clean App.tsx (~200 lines).

### Files to Modify

1. Create `src/components/layout/main-layout.tsx`
2. Update all major components to read from stores
3. Clean up App.tsx
4. Remove all unused hooks

### Implementation Details

#### New MainLayout Component

```typescript
// src/components/layout/main-layout.tsx
import React from 'react';
import CustomTitleBar from '../window/custom-title-bar';
import TabBar from '../tab-bar';
import { MainSidebar } from './main-sidebar';
import CodeEditor from '../editor/code-editor';
import BottomPane from '../bottom-pane';
import ResizableRightPane from '../resizable-right-pane';
import ResizableSidebar from '../resizable-sidebar';
import AIChat from '../ai-chat/ai-chat';
import { useBufferStore } from '../../stores/buffer-store';
import { useUIState } from '../../stores/ui-state-store';
import { useFileSystemStore } from '../../stores/file-system-store';
import { usePersistentSettingsStore } from '../../stores/persistent-settings-store';

export function MainLayout() {
  const { activeBufferId, buffers } = useBufferStore();
  const activeBuffer = buffers.find(b => b.id === activeBufferId);
  
  const { isSidebarVisible, isRightPaneVisible } = useUIState();
  const { rootFolderPath } = useFileSystemStore();
  const { settings, aiChatWidth } = usePersistentSettingsStore();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-primary-bg">
      <CustomTitleBar />
      <div className="h-px flex-shrink-0 bg-border" />
      
      <div className="flex flex-1 flex-row overflow-hidden">
        {/* Left sidebar or AI chat based on settings */}
        {settings.sidebarPosition === "right" ? (
          <ResizableRightPane
            isVisible={isRightPaneVisible}
            defaultWidth={300}
            position="left"
            width={aiChatWidth}
          >
            <AIChat />
          </ResizableRightPane>
        ) : (
          isSidebarVisible && (
            <ResizableSidebar>
              <MainSidebar />
            </ResizableSidebar>
          )
        )}

        {/* Main content area */}
        <div className="flex h-full flex-1 flex-col overflow-hidden">
          <TabBar />
          {activeBuffer ? (
            <CodeEditor />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              Select a file to edit...
            </div>
          )}
        </div>

        {/* Right sidebar or AI chat based on settings */}
        {settings.sidebarPosition === "right" ? (
          isSidebarVisible && (
            <ResizableRightPane isVisible position="right">
              <MainSidebar />
            </ResizableRightPane>
          )
        ) : (
          <ResizableRightPane
            isVisible={isRightPaneVisible}
            defaultWidth={300}
            position="right"
            width={aiChatWidth}
          >
            <AIChat />
          </ResizableRightPane>
        )}
      </div>

      <BottomPane />
    </div>
  );
}
```

#### Updated App.tsx (~200 lines)

```typescript
// src/App.tsx
import { useEffect } from 'react';
import { enableMapSet } from 'immer';
import WelcomeScreen from './components/window/welcome-screen';
import { MainLayout } from './components/layout/main-layout';
import CommandBar from './components/command/command-bar';
import CommandPalette from './components/command/command-palette';
import FindBar from './components/find-bar';
import QuickEditInline from './components/quick-edit-modal';
import GitHubCopilotSettings from './components/github-copilot-settings';
import FileReloadToast from './components/file-reload-toast';
import { ProjectNameMenu } from './components/menus/project-name-menu';
import { useUIState } from './stores/ui-state-store';
import { useFileSystemStore } from './stores/file-system-store';
import { useAppStore } from './stores/app-store';
import { useMenuEvents } from './hooks/use-menu-events';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import { useFileWatcherEvents } from './hooks/use-file-watcher-events';
import { isMac } from './utils/platform';
import { cn } from './utils/cn';

function App() {
  enableMapSet();

  const { isCommandPaletteVisible, isCommandBarVisible } = useUIState();
  const { files, rootFolderPath } = useFileSystemStore();
  const { cleanup, quickEditState } = useAppStore();

  // Platform-specific setup
  useEffect(() => {
    if (isMac()) {
      document.documentElement.classList.add('platform-macos');
    } else {
      document.documentElement.classList.add('platform-other');
    }

    return () => {
      document.documentElement.classList.remove('platform-macos', 'platform-other');
      cleanup(); // Cleanup autosave timeouts
    };
  }, [cleanup]);

  // Initialize event listeners
  useMenuEvents();
  useKeyboardShortcuts();
  useFileWatcherEvents();

  // Check for remote connection from URL
  const urlParams = new URLSearchParams(window.location.search);
  const remoteParam = urlParams.get('remote');
  const isRemoteFromUrl = !!remoteParam;

  // Determine if we should show welcome screen
  const shouldShowWelcome =
    files.length === 0 &&
    !rootFolderPath &&
    !isRemoteFromUrl;

  if (shouldShowWelcome) {
    return <WelcomeScreen />;
  }

  return (
    <div className={cn("flex h-screen w-screen flex-col overflow-hidden bg-transparent")}>
      <div className={cn(
        "window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg",
        isMac() && "rounded-xl",
      )}>
        <MainLayout />

        {/* Global modals and overlays */}
        <CommandBar />
        <CommandPalette />
        <FindBar />
        <QuickEditInline />
        <GitHubCopilotSettings />
        <ProjectNameMenu />
        <FileReloadToast />
      </div>
    </div>
  );
}

export default App;
```

#### Component Updates

##### CodeEditor Component

```typescript
// Update src/components/editor/code-editor.tsx
const CodeEditor = forwardRef<CodeEditorRef>((props, ref) => {
  // No more props! Get everything from stores
  const activeBuffer = useBufferStore(state => state.getActiveBuffer());
  const { handleContentChange } = useAppStore();
  const { vimEnabled, vimMode, fontSize, tabSize, wordWrap, lineNumbers } = useEditorConfigStore();
  const { searchQuery, searchMatches, currentMatchIndex } = useSearchStore();

  if (!activeBuffer) {
    return <div className="flex-1 flex items-center justify-center">Select a file to edit...</div>;
  }

  // Component logic remains the same, just using store values
  return (
    <div className="editor-container">
      {/* Editor content */}
    </div>
  );
});
```

##### MainSidebar Component

```typescript
// Update src/components/layout/main-sidebar.tsx
export const MainSidebar = forwardRef<SearchViewRef>((props, ref) => {
  // Get everything from stores
  const {
    files,
    expandedFolders,
    handleFileSelect,
    handleCreateNewFile,
    handleDeletePath,
    handleFileMove
  } = useFileSystemStore();

  const { rootFolderPath } = useProjectStore();
  const { isSidebarVisible } = useUIState();

  if (!isSidebarVisible) return null;

  return (
    <div className="sidebar">
      {/* Sidebar content using store data */}
    </div>
  );
});
```

##### TabBar Component

```typescript
// Update src/components/tab-bar.tsx
const TabBar = () => {
  // Get everything from stores
  const {
    buffers,
    activeBufferId,
    handleTabClick,
    handleTabClose,
    handleTabPin,
    reorderBuffers
  } = useBufferStore();

  const { maxOpenTabs } = usePersistentSettingsStore();

  return (
    <div className="tab-bar">
      {/* Tab bar using store data and methods */}
    </div>
  );
};
```

### Migration Tasks

1. Create MainLayout component to handle the main app layout
2. Update all components to read from stores instead of props:
   - CodeEditor (remove 23+ props)
   - MainSidebar (remove 12+ props)
   - TabBar
   - BottomPane
   - CommandBar
   - CommandPalette
   - All other components
3. Create simplified event hooks (menu-events, keyboard-shortcuts, file-watcher-events)
4. Remove all remaining handlers from App.tsx
5. Remove all prop drilling
6. Add store DevTools for debugging

### Testing Strategy

1. **Unit Tests**: Test each store in isolation
2. **Integration Tests**: Test store interactions
3. **Component Tests**: Test components with mocked stores
4. **E2E Tests**: Full application flow testing

### Performance Metrics to Track

- Initial render time
- Keystroke latency (should be near-instant)
- Tab switching speed
- File tree operation speed
- Memory usage over time

### Rollback Plan

Implement feature flags for gradual rollout:

```typescript
const USE_NEW_STORE_ARCHITECTURE = true;

// In App.tsx
if (USE_NEW_STORE_ARCHITECTURE) {
  return <AppWithStores />;
} else {
  return <LegacyApp />;
}
```

## Summary

This 3-step migration plan will:

1. **Eliminate performance issues** by preventing callback recreation
2. **Remove prop drilling** entirely
3. **Improve testability** with isolated store actions
4. **Reduce App.tsx from 1528 to ~200 lines**
5. **Maintain all existing functionality**

The key advantages of this 3-step approach:
- **More cohesive steps** - Each focuses on a complete domain
- **Reduced interdependencies** - Related functionality stays together
- **Clearer progression** - Infrastructure → File System → UI Migration
- **Easier implementation** - Can complete each step fully before moving on

Each step is independently valuable and delivers immediate benefits.