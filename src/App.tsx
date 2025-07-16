import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import AIChat from "./components/ai-chat/ai-chat";
import BottomPane from "./components/bottom-pane";
import CommandBar from "./components/command/command-bar";
import CommandPalette, { type CommandPaletteRef } from "./components/command/command-palette";
import type { Diagnostic } from "./components/diagnostics/diagnostics-pane";
import DiffViewer from "./components/diff-viewer";
import BreadcrumbContainer from "./components/editor/breadcrumbs/breadcrumb-container";
import CodeEditor, { type CodeEditorRef } from "./components/editor/code-editor";
import EditorFooter from "./components/editor-footer";
import ExtensionsView from "./components/extensions-view";
import FileReloadToast from "./components/file-reload-toast";
import FindBar from "./components/find-bar";
import GitHubCopilotSettings from "./components/github-copilot-settings";
import ImageViewer from "./components/image-viewer";
import { MainSidebar } from "./components/layout/main-sidebar";
import QuickEditInline from "./components/quick-edit-modal";
import ResizableRightPane from "./components/resizable-right-pane";
import ResizableSidebar from "./components/resizable-sidebar";
import type { SearchViewRef } from "./components/search-view";
import SQLiteViewer from "./components/sqlite-viewer";
import TabBar from "./components/tab-bar";
import CustomTitleBar from "./components/window/custom-title-bar";
import WelcomeScreen from "./components/window/welcome-screen";
import { createCoreFeaturesList, handleCoreFeatureToggle } from "./constants/core-features";
import { useBuffers } from "./hooks/use-buffers";
import { ProjectNameMenu, useContextMenus } from "./hooks/use-context-menus";
import { useFileOperations } from "./hooks/use-file-operations";
import { useFileSelection } from "./hooks/use-file-selection";
import { useFolderOperations } from "./hooks/use-folder-operations";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useLSP } from "./hooks/use-lsp";
import { useMenuEvents } from "./hooks/use-menu-events";
import { useQuickEdit } from "./hooks/use-quick-edit";
import { useRecentFolders } from "./hooks/use-recent-folders";
import { useRemoteConnection } from "./hooks/use-remote-connection";
import { useSearch } from "./hooks/use-search";
import { useSettings } from "./hooks/use-settings";
import { useVim } from "./hooks/use-vim";
import { useCodeEditorStore } from "./stores/code-editor-store";
import {
  cleanupFileWatcherListener,
  initializeFileWatcherListener,
  useFileWatcherStore,
} from "./stores/file-watcher-store";
import { usePersistentSettingsStore } from "./stores/persistent-settings-store";
import { useProjectStore } from "./stores/project-store";
import { useSidebarStore } from "./stores/sidebar-store";
import { useUIState } from "./stores/ui-state-store";
import type { FileEntry } from "./types/app";
import { type CoreFeaturesState, DEFAULT_CORE_FEATURES } from "./types/core-features";
import type { ThemeType } from "./types/theme";
import { cn } from "./utils/cn";
import { getFilenameFromPath, getLanguageFromFilename } from "./utils/file-utils";
import type { GitDiff } from "./utils/git";
import { isMac, readFile, writeFile } from "./utils/platform";

function App() {
  const uiState = useUIState();
  const { settings, updateSetting, updateSettingsFromJSON } = useSettings();
  const quickEdit = useQuickEdit();
  const { aiChatWidth, setAIChatWidth, isAIChatVisible, setIsAIChatVisible } =
    usePersistentSettingsStore();

  // Context menus hook
  const contextMenus = useContextMenus({
    folderHeaderContextMenu: uiState.folderHeaderContextMenu,
    projectNameMenu: uiState.projectNameMenu,
    setFolderHeaderContextMenu: uiState.setFolderHeaderContextMenu,
    setProjectNameMenu: uiState.setProjectNameMenu,
  });

  // Legacy state that still needs to be managed here
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [coreFeatures, setCoreFeatures] = useState<CoreFeaturesState>(() => {
    const saved = localStorage.getItem("athas-code-core-features");
    if (saved) {
      try {
        return { ...DEFAULT_CORE_FEATURES, ...JSON.parse(saved) };
      } catch (error) {
        console.error("Error loading core features:", error);
      }
    }
    return DEFAULT_CORE_FEATURES;
  });
  const [maxOpenTabs, setMaxOpenTabs] = useState<number>(10);
  const [isTerminalFullScreen, setIsTerminalFullScreen] = useState(false);

  // Recent folders management
  const { recentFolders, addToRecents } = useRecentFolders();

  const codeEditorRef = useRef<CodeEditorRef>(null);
  const searchViewRef = useRef<SearchViewRef>(null);
  const commandPaletteRef = useRef<CommandPaletteRef>(null);

  // Autosave timeout ref for proper cleanup
  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply platform-specific CSS class on mount
  useEffect(() => {
    if (isMac()) {
      document.documentElement.classList.add("platform-macos");
    } else {
      document.documentElement.classList.add("platform-other");
    }

    // Cleanup on unmount
    return () => {
      document.documentElement.classList.remove("platform-macos", "platform-other");
      // Clean up autosave timeout on unmount
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  // Initialize AI chat visibility from persistent store
  useEffect(() => {
    if (isAIChatVisible !== uiState.isRightPaneVisible) {
      uiState.setIsRightPaneVisible(isAIChatVisible);
    }
  }, []); // Only run once on mount

  // Save AI chat visibility when it changes
  useEffect(() => {
    setIsAIChatVisible(uiState.isRightPaneVisible);
  }, [uiState.isRightPaneVisible, setIsAIChatVisible]);

  // Core features handling
  const coreFeaturesList = createCoreFeaturesList(coreFeatures);
  const handleCoreFeatureToggleLocal = (featureId: string, enabled: boolean) => {
    handleCoreFeatureToggle(featureId, enabled, coreFeatures, setCoreFeatures);
  };

  // Buffer management
  const {
    buffers,
    activeBufferId,
    openBuffer,
    closeBuffer,
    setActiveBuffer,
    updateBufferContent,
    markBufferDirty,
    updateBuffer,
    getActiveBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    reorderBuffers,
  } = useBuffers();

  const activeBuffer = getActiveBuffer();

  // Import vim state from stores
  const { vimEnabled, vimMode, setVimEnabled, setVimMode, setCursorPosition } =
    useCodeEditorStore();

  // Create a ref that points to the editor div
  const editorDivRef = useRef<HTMLDivElement>(null!);

  // Initialize vim engine
  const vim = useVim(
    editorDivRef,
    activeBuffer?.content || "",
    (content: string) => {
      if (activeBuffer) {
        updateBufferContent(activeBuffer.id, content);
      }
    },
    vimEnabled,
    setCursorPosition,
    setVimMode,
    () => {}, // onShowCommandLine - to be implemented
  );

  // Vim helper functions
  const toggleVimMode = useCallback(() => {
    setVimEnabled(!vimEnabled);
    if (!vimEnabled) {
      setVimMode("normal");
    }
  }, [vimEnabled, setVimEnabled, setVimMode]);

  const handleVimKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (vimEnabled && vim.vimEngine && codeEditorRef.current?.editor) {
        const editor = codeEditorRef.current.editor;
        const content = activeBuffer?.content || "";
        const handled = vim.vimEngine.handleKeyDown(e, editor, content);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    [vimEnabled, vim.vimEngine, codeEditorRef, activeBuffer?.content],
  );

  const updateCursorPosition = useCallback(() => {
    // This is called from file selection to reset cursor position
    setCursorPosition(0);
  }, [setCursorPosition]);

  // Apply vim mode from settings
  useEffect(() => {
    if (settings.vimMode !== vimEnabled) {
      setVimEnabled(settings.vimMode);
      if (settings.vimMode) {
        setVimMode("normal");
      }
    }
  }, [settings.vimMode, vimEnabled, setVimEnabled, setVimMode]);

  const projectStore = useProjectStore();
  const sidebarStore = useSidebarStore();
  const { allProjectFiles, setAllProjectFiles } = projectStore;
  const [_isDraggingTab, setIsDraggingTab] = useState(false);

  // File operations with proper callback
  const {
    files: localFiles,
    setFiles: localSetFiles,
    rootFolderPath,
    getAllProjectFiles,
    handleOpenFolder,
    handleOpenFolderByPath,
    handleFolderToggle: localHandleFolderToggle,
    handleCreateNewFile,
    handleCreateNewFileInDirectory,
    handleCreateNewFolderInDirectory,
    handleDeletePath,
    handleCollapseAllFolders,
    refreshDirectory,
  } = useFileOperations({ openBuffer });

  // Sync files from useFileOperations to project store
  const { files } = projectStore;
  useEffect(() => {
    console.log(`🔄 Syncing ${localFiles.length} files to project store`);
    projectStore.setFiles(localFiles);
  }, [localFiles]);

  // Create setFiles function that updates both local and store
  const setFilesCombined = useCallback(
    (newFiles: FileEntry[]) => {
      localSetFiles(newFiles);
      projectStore.setFiles(newFiles);
    },
    [localSetFiles],
  );

  // File watcher store - get external changes as array
  const startWatching = useFileWatcherStore(state => state.startWatching);
  const markPendingSave = useFileWatcherStore(state => state.markPendingSave);
  const setProjectRoot = useFileWatcherStore(state => state.setProjectRoot);
  // const clearPendingSave = useFileWatcherStore(state => state.clearPendingSave); // Reserved for future use
  // const stopWatching = useFileWatcherStore((state) => state.stopWatching); // Reserved for future use

  // Initialize file watcher listeners only once when app starts
  useEffect(() => {
    initializeFileWatcherListener();

    return () => {
      cleanupFileWatcherListener();
    };
  }, []); // Only run once on mount

  // Listen for file external changes
  useEffect(() => {
    const handleFileExternalChange = (event: CustomEvent) => {
      const { path, changeType } = event.detail;

      // Check if this file is open in any buffer
      const buffer = buffers.find(b => b.path === path);

      if (buffer && changeType === "modified") {
        // Auto-reload all files regardless of dirty state
        readFile(path)
          .then((content: string) => {
            updateBufferContent(buffer.id, content, false);
            // Dispatch event for toast notification
            window.dispatchEvent(new CustomEvent("file-reloaded", { detail: { path } }));
          })
          .catch((error: Error) => {
            console.error("❌ Failed to auto-reload file:", path, error);
          });
      }

      // Handle file tree updates for all change types
      if (rootFolderPath && path.startsWith(rootFolderPath)) {
        const dirPath = path.substring(0, path.lastIndexOf("/"));

        console.log(`📂 File system change detected: ${changeType} on ${path}`);
        console.log(`📁 Will refresh directory: ${dirPath}`);

        // Refresh the directory containing the changed file
        // This will handle created, modified, and deleted files
        refreshDirectory(dirPath);

        // For deleted files that are open, close the buffer
        if (changeType === "deleted" && buffer) {
          closeBuffer(buffer.id);
        }
      }
    };

    window.addEventListener("file-external-change", handleFileExternalChange as any);

    return () => {
      window.removeEventListener("file-external-change", handleFileExternalChange as any);
    };
  }, [buffers, updateBufferContent, rootFolderPath, refreshDirectory, closeBuffer]);

  // Watch individual files based on open buffers
  useEffect(() => {
    const currentPaths = new Set(
      buffers
        .filter(buffer => !buffer.isVirtual && !buffer.path.startsWith("diff://"))
        .map(buffer => buffer.path),
    );

    // Start watching new files
    currentPaths.forEach(path => {
      startWatching(path);
    });

    // TODO: Consider cleaning up watchers for closed files
  }, [buffers, startWatching]);

  // Function to refresh all project files (needed by remote connection hook)
  const refreshAllProjectFiles = useCallback(async () => {
    if (rootFolderPath && getAllProjectFiles) {
      try {
        const projectFiles = await getAllProjectFiles();
        setAllProjectFiles(projectFiles);
      } catch (error) {
        console.error("Error refreshing all project files:", error);
      }
    }
  }, [rootFolderPath, getAllProjectFiles]);

  // Remote connection management
  const {
    isRemoteWindow,
    remoteConnectionId,
    remoteConnectionName,
    handleRemoteFileSelect: remoteFileSelect,
    handleRemoteFolderToggle,
    handleRemoteCollapseAllFolders,
  } = useRemoteConnection(files, setFilesCombined);

  // Unified folder operations (handles both local and remote)
  const { handleFolderToggle, handleCollapseAllFolders: handleCollapseAllFoldersComplete } =
    useFolderOperations({
      isRemoteWindow,
      remoteConnectionId,
      files,
      setFiles: setFilesCombined,
      localHandleFolderToggle,
      localHandleCollapseAllFolders: handleCollapseAllFolders,
      handleRemoteFolderToggle,
      handleRemoteCollapseAllFolders,
    });

  // File selection functionality
  const { handleFileSelect } = useFileSelection({
    openBuffer,
    handleFolderToggle,
    vimEnabled,
    setVimMode,
    updateCursorPosition,
    codeEditorRef,
  });

  // LSP integration (after rootFolderPath is available)
  const {
    openDocument,
    changeDocument,
    closeDocument,
    getCompletions,
    getHover,
    isLanguageSupported,
  } = useLSP({
    workspaceRoot: rootFolderPath || undefined,
    onDiagnostics: diagnostics => {
      setDiagnostics(diagnostics);
    },
  });

  // Function to refresh all project files - handles only local files (remote has no indexing)
  const refreshAllProjectFilesComplete = useCallback(async () => {
    if (!isRemoteWindow) {
      refreshAllProjectFiles();
    } else {
      setAllProjectFiles([]);
    }
  }, [isRemoteWindow, refreshAllProjectFiles]);

  // Load all project files when root folder changes or remote connection changes
  useEffect(() => {
    refreshAllProjectFilesComplete();
  }, [refreshAllProjectFilesComplete]);

  // Sync rootFolderPath to project store and start watching it
  useEffect(() => {
    projectStore.setRootFolderPath(rootFolderPath);

    // Start watching the root folder for changes
    if (rootFolderPath) {
      setProjectRoot(rootFolderPath);
    }
  }, [rootFolderPath, setProjectRoot]);

  // Update sidebar store with active buffer path
  useEffect(() => {
    sidebarStore.setActiveBufferPath(activeBuffer?.path);
  }, [activeBuffer?.path]);

  // Update sidebar store with remote info
  useEffect(() => {
    sidebarStore.setIsRemoteWindow(isRemoteWindow);
    sidebarStore.setRemoteConnectionName(remoteConnectionName || undefined);
  }, [isRemoteWindow, remoteConnectionName]);

  // Update core features in sidebar store
  useEffect(() => {
    sidebarStore.setCoreFeatures(coreFeatures);
  }, [coreFeatures]);

  // Handle opening Extensions as a buffer
  const handleOpenExtensions = () => {
    openBuffer("extensions://language-servers", "Extensions", "", false, false, false, true);
  };

  // Track when a new folder is opened and add to recents
  useEffect(() => {
    if (rootFolderPath) {
      addToRecents(rootFolderPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFolderPath]);

  const handleOpenRecentFolder = async (path: string) => {
    const success = await handleOpenFolderByPath(path);

    if (success) {
      addToRecents(path);
    } else {
      console.error("Failed to open recent folder:", path);
      // Show an error message instead of opening the directory picker
      alert(`Unable to open folder: ${path}\n\nThe folder may have been moved or deleted.`);
    }
  };

  // Search functionality
  const {
    searchState,
    isFindVisible,
    setIsFindVisible,
    performSearch,
    handleSearchQueryChange,
    handleFindClose,
  } = useSearch({ activeBuffer, codeEditorRef });

  // Function to focus search input
  const focusSearchInput = () => {
    if (searchViewRef.current) {
      searchViewRef.current.focusInput();
    }
  };

  // Function to focus command palette
  const focusCommandPalette = () => {
    if (commandPaletteRef.current) {
      commandPaletteRef.current.focus();
    }
  };

  // Handle save shortcut
  const handleSave = () => {
    if (!activeBuffer) return;

    if (activeBuffer.isVirtual) {
      if (activeBuffer.path === "settings://user-settings.json") {
        const success = updateSettingsFromJSON(activeBuffer.content);
        if (success) {
          markBufferDirty(activeBuffer.id, false);
          console.log("Settings applied successfully");

          try {
            const parsedSettings = JSON.parse(activeBuffer.content);
            if (parsedSettings.maxOpenTabs !== undefined) {
              setMaxOpenTabs(parsedSettings.maxOpenTabs);
            }
          } catch (_error) {
            // Already handled in updateSettingsFromJSON
          }
        } else {
          markBufferDirty(activeBuffer.id, true);
        }
      } else {
        markBufferDirty(activeBuffer.id, false);
      }
    } else {
      if (activeBuffer.path.startsWith("remote://")) {
        markBufferDirty(activeBuffer.id, true);

        const pathParts = activeBuffer.path.replace("remote://", "").split("/");
        const connectionId = pathParts.shift();
        const remotePath = `/${pathParts.join("/")}`;

        if (connectionId) {
          (async () => {
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
          })();
        }
      } else {
        (async () => {
          try {
            // Mark as pending save before writing
            markPendingSave(activeBuffer.path);
            await writeFile(activeBuffer.path, activeBuffer.content);
            markBufferDirty(activeBuffer.id, false);
          } catch (error) {
            console.error("Error saving local file:", error);
            markBufferDirty(activeBuffer.id, true);
          }
        })();
      }
    }
  };

  const handleQuickEdit = () => {
    if (!activeBuffer || !codeEditorRef.current?.editor) return;

    const editor = codeEditorRef.current.editor;
    const selection = window.getSelection();
    if (!selection) return;

    const selectedText = selection.toString();
    const editorRect = editor.getBoundingClientRect();
    const scrollLeft = editor.scrollLeft;
    const scrollTop = editor.scrollTop;

    // Get cursor position for contenteditable
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const cursorX = rect.left - editorRect.left + scrollLeft;
    const cursorY = rect.top - editorRect.top + scrollTop;

    let text = selectedText;
    let selectionRange = { start: 0, end: 0 };

    if (selectedText) {
      // Use selected text
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(editor);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      const start = preCaretRange.toString().length;
      const end = start + selectedText.length;
      selectionRange = { start, end };
    } else {
      // Select current line if no selection
      const lines = activeBuffer.content.split("\n");
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(editor);
      preCaretRange.setEnd(range.startContainer, range.startOffset);
      const cursorPos = preCaretRange.toString().length;

      let currentPos = 0;
      let lineIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        if (currentPos + lines[i].length >= cursorPos) {
          lineIndex = i;
          break;
        }
        currentPos += lines[i].length + 1;
      }

      const lineStart = currentPos;
      const lineEnd = currentPos + lines[lineIndex].length;
      text = lines[lineIndex];
      selectionRange = { start: lineStart, end: lineEnd };
    }

    quickEdit.openQuickEdit({
      text,
      cursorPosition: { x: cursorX, y: cursorY },
      selectionRange,
    });
  };

  const handleQuickEditApply = (editedText: string) => {
    if (!activeBuffer || !codeEditorRef.current?.editor) return;

    const editor = codeEditorRef.current.editor;
    const { start, end } = quickEdit.selectionRange;

    const newContent =
      activeBuffer.content.substring(0, start) + editedText + activeBuffer.content.substring(end);

    updateBufferContent(activeBuffer.id, newContent);

    requestAnimationFrame(() => {
      editor.focus();
      // Set cursor position in contenteditable
      const range = document.createRange();
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
      let node: Node | null = walker.nextNode();
      while (node) {
        textNodes.push(node as Text);
        node = walker.nextNode();
      }

      let currentPos = 0;
      const targetStart = start;
      const targetEnd = start + editedText.length;

      for (const textNode of textNodes) {
        const nodeLength = textNode.textContent?.length || 0;
        if (currentPos + nodeLength >= targetStart) {
          const startOffset = targetStart - currentPos;
          const endOffset = Math.min(targetEnd - currentPos, nodeLength);
          range.setStart(textNode, startOffset);
          range.setEnd(textNode, endOffset);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          break;
        }
        currentPos += nodeLength;
      }
    });

    quickEdit.closeQuickEdit();
  };

  const handleQuickEditClose = () => {
    quickEdit.closeQuickEdit();
  };

  const handleToggleSidebarPosition = () => {
    const newPosition = settings.sidebarPosition === "left" ? "right" : "left";
    updateSetting("sidebarPosition", newPosition);
  };

  // Handle file move complete (used by drag and drop)
  const handleFileMoveComplete = useCallback(
    (oldPath: string, newPath: string) => {
      console.log("Updating buffers after file move:", oldPath, "->", newPath);

      // Find any buffers with the old path
      const affectedBuffer = buffers.find(b => b.path === oldPath);
      if (affectedBuffer) {
        const pathSep = newPath.includes("\\") ? "\\" : "/";
        const fileName = newPath.split(pathSep).pop() || affectedBuffer.name;
        console.log("Updating buffer:", affectedBuffer.id, "with new path:", newPath);

        // Update the buffer with the new path and name
        updateBuffer({
          ...affectedBuffer,
          path: newPath,
          name: fileName,
        });
      }
    },
    [buffers, updateBuffer],
  );

  const handleApplyCodeFromChat = (code: string) => {
    if (!activeBuffer || !codeEditorRef.current?.editor) return;

    const editor = codeEditorRef.current.editor;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(editor);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    const start = preCaretRange.toString().length;
    const end = start + selection.toString().length;

    const newContent =
      activeBuffer.content.substring(0, start) + code + activeBuffer.content.substring(end);

    updateBufferContent(activeBuffer.id, newContent);

    requestAnimationFrame(() => {
      editor.focus();
      // Set cursor position after the inserted code
      const newCursorPosition = start + code.length;
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
      let node: Node | null = walker.nextNode();
      while (node) {
        textNodes.push(node as Text);
        node = walker.nextNode();
      }

      let currentPos = 0;
      for (const textNode of textNodes) {
        const nodeLength = textNode.textContent?.length || 0;
        if (currentPos + nodeLength >= newCursorPosition) {
          const newRange = document.createRange();
          const offset = newCursorPosition - currentPos;
          newRange.setStart(textNode, Math.min(offset, nodeLength));
          newRange.setEnd(textNode, Math.min(offset, nodeLength));
          selection.removeAllRanges();
          selection.addRange(newRange);
          break;
        }
        currentPos += nodeLength;
      }
    });
  };

  // Menu events hook - placed after all dependencies are defined
  useMenuEvents({
    onNewFile: handleCreateNewFile,
    onOpenFolder: handleOpenFolder,
    onSave: handleSave,
    onSaveAs: () => {
      console.log("Save As triggered from menu");
    },
    onCloseTab: () => {
      if (activeBufferId) {
        closeBuffer(activeBufferId);
      }
    },
    onUndo: () => {
      if (codeEditorRef.current?.editor) {
        document.execCommand("undo");
      }
    },
    onRedo: () => {
      if (codeEditorRef.current?.editor) {
        document.execCommand("redo");
      }
    },
    onFind: () => {
      setIsFindVisible(true);
    },
    onFindReplace: () => {
      setIsFindVisible(true);
    },
    onCommandPalette: () => {
      uiState.setIsCommandPaletteVisible(true);
    },
    onToggleSidebar: () => {
      uiState.setIsSidebarVisible(!uiState.isSidebarVisible);
    },
    onToggleTerminal: () => {
      uiState.setBottomPaneActiveTab("terminal");
      uiState.setIsBottomPaneVisible(
        !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "terminal",
      );
    },
    onToggleAiChat: () => {
      uiState.setIsRightPaneVisible(!uiState.isRightPaneVisible);
    },
    onSplitEditor: () => {
      console.log("Split editor triggered from menu");
    },
    onToggleVim: () => {
      toggleVimMode();
    },
    onGoToFile: () => {
      uiState.setIsCommandBarVisible(true);
    },
    onGoToLine: () => {
      const line = prompt("Go to line:");
      if (line && codeEditorRef.current?.editor) {
        const lineNumber = parseInt(line, 10);
        if (!Number.isNaN(lineNumber)) {
          const editor = codeEditorRef.current.editor;
          const lines = activeBuffer?.content.split("\n") || [];
          let targetPosition = 0;

          for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
            targetPosition += lines[i].length + 1;
          }

          editor.focus();
          // Set cursor position in contenteditable
          const textNodes: Text[] = [];
          const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
          let node: Node | null = walker.nextNode();
          while (node) {
            textNodes.push(node as Text);
            node = walker.nextNode();
          }

          let currentPos = 0;
          for (const textNode of textNodes) {
            const nodeLength = textNode.textContent?.length || 0;
            if (currentPos + nodeLength >= targetPosition) {
              const range = document.createRange();
              const offset = targetPosition - currentPos;
              range.setStart(textNode, Math.min(offset, nodeLength));
              range.setEnd(textNode, Math.min(offset, nodeLength));
              const selection = window.getSelection();
              if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
              }
              break;
            }
            currentPos += nodeLength;
          }
        }
      }
    },
    onNextTab: switchToNextBuffer,
    onPrevTab: switchToPreviousBuffer,
    onThemeChange: (theme: string) => {
      handleThemeChange(theme as ThemeType);
    },
    onAbout: () => {
      // Native About dialog is handled by the menu system
    },
    onHelp: () => {
      console.log("Help triggered from menu");
    },
  });

  // Keyboard shortcuts
  useKeyboardShortcuts({
    setIsBottomPaneVisible: v =>
      uiState.setIsBottomPaneVisible(typeof v === "function" ? v(uiState.isBottomPaneVisible) : v),
    setBottomPaneActiveTab: uiState.setBottomPaneActiveTab,
    setIsSidebarVisible: v =>
      uiState.setIsSidebarVisible(typeof v === "function" ? v(uiState.isSidebarVisible) : v),
    setIsFindVisible,
    setIsRightPaneVisible: v =>
      uiState.setIsRightPaneVisible(typeof v === "function" ? v(uiState.isRightPaneVisible) : v),
    setIsCommandBarVisible: v =>
      uiState.setIsCommandBarVisible(typeof v === "function" ? v(uiState.isCommandBarVisible) : v),
    setIsCommandPaletteVisible: v =>
      uiState.setIsCommandPaletteVisible(
        typeof v === "function" ? v(uiState.isCommandPaletteVisible) : v,
      ),
    setIsSearchViewActive: uiState.setIsSearchViewActive,
    focusSearchInput,
    focusCommandPalette,
    activeBuffer,
    closeBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    buffers,
    setActiveBuffer,
    isBottomPaneVisible: uiState.isBottomPaneVisible,
    bottomPaneActiveTab: uiState.bottomPaneActiveTab,
    onSave: handleSave,
    onQuickEdit: handleQuickEdit,
    onToggleSidebarPosition: handleToggleSidebarPosition,
    coreFeatures,
  });

  // Handle Tauri file drop events - TEMPORARILY DISABLED
  // TODO: Find a way to support both Tauri file drops and HTML5 drag and drop
  // The commented code below was preventing HTML5 drag and drop from working
  /*
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupFileDrop = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        
        unlisten = await listen("tauri://file-drop", async event => {
          console.log("Files dropped:", event.payload);
          // The payload contains an array of file paths
          const files = event.payload as string[];

          if (files.length > 0 && rootFolderPath) {
            // Copy files to the current root folder
            for (const filePath of files) {
              const fileName = filePath.split("/").pop() || filePath.split("\\").pop() || "unknown";
              try {
                const { copyExternalFile } = await import("./utils/platform");
                await copyExternalFile(filePath, rootFolderPath, fileName);
                console.log(`Copied ${fileName} to ${rootFolderPath}`);
              } catch (error) {
                console.error(`Failed to copy ${fileName}:`, error);
              }
            }

            // Refresh the root directory to show new files
            if (refreshDirectory) {
              refreshDirectory(rootFolderPath);
            }
          }
        });
      } catch (error) {
        console.error("Failed to setup file drop listener:", error);
      }
    };

    setupFileDrop();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [rootFolderPath, refreshDirectory]);
  */

  useEffect(() => {
    const handleNavigateToLine = (event: CustomEvent) => {
      const { line } = event.detail;
      if (codeEditorRef.current?.editor) {
        const editor = codeEditorRef.current.editor;
        const lines = activeBuffer?.content.split("\n") || [];
        let targetPosition = 0;

        for (let i = 0; i < line - 1 && i < lines.length; i++) {
          targetPosition += lines[i].length + 1;
        }

        editor.focus();
        // Set cursor position in contenteditable
        const textNodes: Text[] = [];
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
        let node: Node | null = walker.nextNode();
        while (node) {
          textNodes.push(node as Text);
          node = walker.nextNode();
        }

        let currentPos = 0;
        for (const textNode of textNodes) {
          const nodeLength = textNode.textContent?.length || 0;
          if (currentPos + nodeLength >= targetPosition) {
            const range = document.createRange();
            const offset = targetPosition - currentPos;
            range.setStart(textNode, Math.min(offset, nodeLength));
            range.setEnd(textNode, Math.min(offset, nodeLength));
            const selection = window.getSelection();
            if (selection) {
              selection.removeAllRanges();
              selection.addRange(range);
            }
            break;
          }
          currentPos += nodeLength;
        }

        const lineHeight = 20;
        const scrollTop = Math.max(0, (line - 1) * lineHeight - editor.clientHeight / 2);
        editor.scrollTop = scrollTop;
      }
    };

    window.addEventListener("navigate-to-line", handleNavigateToLine as any);
    return () => {
      window.removeEventListener("navigate-to-line", handleNavigateToLine as any);
    };
  }, [activeBuffer]);

  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeBuffer) return;
      const isRemoteFile = activeBuffer.path.startsWith("remote://");

      if (isRemoteFile) {
        updateBufferContent(activeBuffer.id, content, false);
      } else {
        updateBufferContent(activeBuffer.id, content, true);

        if (!activeBuffer.isVirtual && settings.autoSave) {
          if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
          }
          autoSaveTimeoutRef.current = setTimeout(async () => {
            try {
              // Mark as pending save before auto-saving
              markPendingSave(activeBuffer.path);
              await writeFile(activeBuffer.path, content);
              markBufferDirty(activeBuffer.id, false);
            } catch (error) {
              console.error("Error saving local file:", error);
              markBufferDirty(activeBuffer.id, true);
            }
          }, 150);
        }
      }
    },
    [activeBuffer, updateBufferContent, markBufferDirty, settings.autoSave, markPendingSave],
  );

  const handleTabClick = (bufferId: string) => {
    setActiveBuffer(bufferId);
  };

  const handleTabClose = (bufferId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    closeBuffer(bufferId);
  };

  const handleTabPin = (bufferId: string) => {
    const buffer = buffers.find(b => b.id === bufferId);
    if (buffer) {
      updateBuffer({
        ...buffer,
        isPinned: !buffer.isPinned,
      });
    }
  };

  const handleCloseOtherTabs = (keepBufferId: string) => {
    const buffersToClose = buffers.filter(b => b.id !== keepBufferId && !b.isPinned);
    buffersToClose.forEach(buffer => closeBuffer(buffer.id));
  };

  const handleCloseAllTabs = () => {
    const buffersToClose = buffers.filter(b => !b.isPinned);
    buffersToClose.forEach(buffer => closeBuffer(buffer.id));
  };

  const handleCloseTabsToRight = (bufferId: string) => {
    const bufferIndex = buffers.findIndex(b => b.id === bufferId);
    if (bufferIndex === -1) return;

    const buffersToClose = buffers.slice(bufferIndex + 1).filter(b => !b.isPinned);
    buffersToClose.forEach(buffer => closeBuffer(buffer.id));
  };

  // Split view handlers (simplified for performance)
  // Handle tab drag start
  const handleTabDragStart = () => {
    setIsDraggingTab(true);
  };

  // Handle tab drag end
  const handleTabDragEnd = () => {
    setIsDraggingTab(false);
  };

  // Command bar handlers
  const handleCommandBarClose = () => {
    uiState.setIsCommandBarVisible(false);
  };

  const handleCommandBarFileSelect = async (path: string) => {
    await handleFileSelect(path, false);
    uiState.setIsCommandBarVisible(false);
  };

  // Command palette handlers
  const handleCommandPaletteClose = () => {
    uiState.setIsCommandPaletteVisible(false);
  };

  const handleThemeChange = (theme: string) => {
    updateSetting("theme", theme as any);
  };

  const handleDiagnosticClick = (diagnostic: Diagnostic) => {
    if (codeEditorRef.current?.editor) {
      const editor = codeEditorRef.current.editor;
      const lines = activeBuffer?.content.split("\n") || [];
      let targetPosition = 0;

      for (let i = 0; i < diagnostic.line - 1 && i < lines.length; i++) {
        targetPosition += lines[i].length + 1;
      }
      targetPosition += diagnostic.column - 1;

      editor.focus();
      // Set cursor position in contenteditable
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
      let node: Node | null = walker.nextNode();
      while (node) {
        textNodes.push(node as Text);
        node = walker.nextNode();
      }

      let currentPos = 0;
      for (const textNode of textNodes) {
        const nodeLength = textNode.textContent?.length || 0;
        if (currentPos + nodeLength >= targetPosition) {
          const range = document.createRange();
          const offset = targetPosition - currentPos;
          range.setStart(textNode, Math.min(offset, nodeLength));
          range.setEnd(textNode, Math.min(offset, nodeLength));
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          break;
        }
        currentPos += nodeLength;
      }
    }
  };

  // Determine what to show: remote window, welcome screen, or main app
  const urlParams = new URLSearchParams(window.location.search);
  const remoteParam = urlParams.get("remote");
  const isRemoteFromUrl = !!remoteParam;

  // Check if we should show welcome screen (no folder open and not a remote window)
  const shouldShowWelcome =
    files.length === 0 &&
    !isRemoteWindow &&
    !remoteConnectionId &&
    !isRemoteFromUrl &&
    !remoteParam;

  if (shouldShowWelcome) {
    return (
      <div className={cn("flex h-screen w-screen flex-col overflow-hidden bg-transparent")}>
        <div className="window-container flex h-full w-full flex-col overflow-hidden bg-white">
          <CustomTitleBar showMinimal={true} isWelcomeScreen={true} />
          <WelcomeScreen
            onOpenFolder={handleOpenFolder}
            recentFolders={recentFolders}
            onOpenRecentFolder={handleOpenRecentFolder}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-screen w-screen flex-col overflow-hidden bg-transparent")}>
      <div
        className={cn(
          "window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg",
          isMac() && "rounded-xl",
        )}
      >
        {/* Custom Titlebar */}
        <CustomTitleBar
          projectName={
            projectStore.getProjectName() !== "Explorer" ? projectStore.getProjectName() : undefined
          }
          onAIChatClick={() => uiState.toggleRightPane()}
          isAIChatVisible={uiState.isRightPaneVisible}
          onSettingsClick={() => {
            // Create settings JSON buffer with current values
            const settingsContent = JSON.stringify(
              {
                ...settings,
                maxOpenTabs: maxOpenTabs,
              },
              null,
              2,
            );
            openBuffer(
              "settings://user-settings.json",
              "settings.json",
              settingsContent,
              false,
              false,
              false,
              true,
            );
          }}
        />

        {/* Thin separator bar */}
        <div className="h-px flex-shrink-0 bg-border" />

        {/* Main App Content */}
        <div className="flex h-full w-full flex-col overflow-hidden bg-primary-bg">
          <div className="custom-scrollbar-auto flex flex-1 flex-row overflow-hidden">
            {/* Left Side - AI Chat (when sidebar is on right) or File Tree (when sidebar is on left) */}
            {settings.sidebarPosition === "right"
              ? // AI Chat on left when sidebar is on right
                coreFeatures.aiChat && (
                  <ResizableRightPane
                    isVisible={uiState.isRightPaneVisible}
                    defaultWidth={300}
                    minWidth={280}
                    maxWidth={600}
                    position="left"
                    width={aiChatWidth}
                    onWidthChange={setAIChatWidth}
                  >
                    <AIChat
                      activeBuffer={activeBuffer}
                      buffers={buffers}
                      rootFolderPath={rootFolderPath}
                      selectedFiles={[]}
                      allProjectFiles={allProjectFiles}
                      mode="chat"
                      onApplyCode={handleApplyCodeFromChat}
                    />
                  </ResizableRightPane>
                )
              : // File Tree on left when sidebar is on left
                uiState.isSidebarVisible && (
                  <ResizableSidebar defaultWidth={220} minWidth={200} maxWidth={400}>
                    <MainSidebar
                      ref={searchViewRef}
                      onOpenExtensions={handleOpenExtensions}
                      onOpenFolder={handleOpenFolder}
                      onCreateNewFile={handleCreateNewFile}
                      onCreateNewFolderInDirectory={handleCreateNewFolderInDirectory}
                      onFileSelect={
                        isRemoteWindow
                          ? async (path: string, isDir: boolean) => {
                              if (isDir) {
                                await handleFolderToggle(path);
                              } else {
                                await remoteFileSelect(path, isDir, openBuffer);
                              }
                            }
                          : handleFileSelect
                      }
                      onCreateNewFileInDirectory={handleCreateNewFileInDirectory}
                      onDeletePath={handleDeletePath}
                      onUpdateFiles={setFilesCombined}
                      onProjectNameMenuOpen={contextMenus.handleProjectNameMenuOpen}
                      onRefreshDirectory={refreshDirectory}
                      onFileMove={handleFileMoveComplete}
                    />
                  </ResizableSidebar>
                )}

            {/* Main Content Area */}
            <div className="flex h-full flex-1 flex-col overflow-hidden bg-primary-bg">
              {/* Tab Bar */}
              <TabBar
                buffers={buffers}
                activeBufferId={activeBufferId}
                onTabClick={handleTabClick}
                onTabClose={handleTabClose}
                onTabReorder={reorderBuffers}
                onTabPin={handleTabPin}
                onCloseOtherTabs={handleCloseOtherTabs}
                onCloseAllTabs={handleCloseAllTabs}
                onCloseTabsToRight={handleCloseTabsToRight}
                onTabDragStart={handleTabDragStart}
                onTabDragEnd={handleTabDragEnd}
                maxOpenTabs={maxOpenTabs}
                externallyModifiedPaths={new Set()}
              />

              {/* Breadcrumb - Hidden in git view and extensions view */}
              {!uiState.isGitViewActive &&
                activeBuffer?.path !== "extensions://language-servers" && (
                  <BreadcrumbContainer
                    activeBuffer={activeBuffer}
                    rootFolderPath={rootFolderPath}
                    onFileSelect={handleFileSelect}
                  />
                )}

              {/* Find Bar */}
              <FindBar
                isVisible={isFindVisible}
                onClose={handleFindClose}
                onSearch={performSearch}
                searchQuery={searchState.query}
                onSearchQueryChange={handleSearchQueryChange}
                currentMatch={searchState.currentMatch}
                totalMatches={searchState.totalMatches}
              />

              {/* Main Editor Content */}
              {activeBuffer ? (
                activeBuffer.isSQLite ? (
                  <SQLiteViewer databasePath={activeBuffer.path} />
                ) : activeBuffer.isImage ? (
                  <ImageViewer imagePath={activeBuffer.path} />
                ) : activeBuffer.isDiff ? (
                  <DiffViewer
                    diff={(() => {
                      try {
                        return JSON.parse(activeBuffer.content) as GitDiff;
                      } catch {
                        return null;
                      }
                    })()}
                    onClose={() => closeBuffer(activeBuffer.id)}
                    fileName={activeBuffer.name}
                  />
                ) : activeBuffer.path === "extensions://language-servers" ? (
                  <ExtensionsView
                    onServerInstall={server => {
                      console.log("Installing server:", server.name);
                      // Here you would integrate with the LSP system
                    }}
                    onServerUninstall={serverId => {
                      console.log("Uninstalling server:", serverId);
                      // Here you would clean up the LSP system
                    }}
                    onThemeChange={handleThemeChange}
                    currentTheme={settings.theme}
                    coreFeatures={coreFeaturesList}
                    onCoreFeatureToggle={handleCoreFeatureToggleLocal}
                  />
                ) : (
                  <CodeEditor
                    value={activeBuffer.content}
                    onChange={content =>
                      vimMode === "insert" || !vimEnabled ? handleContentChange(content) : undefined
                    }
                    onKeyDown={handleVimKeyDown}
                    onCursorPositionChange={position => {
                      if (vimEnabled) {
                        setCursorPosition(position);
                      }
                    }}
                    placeholder="Select a file to edit..."
                    disabled={!activeBuffer}
                    className={vimEnabled && vimMode === "visual" ? "vim-visual-selection" : ""}
                    filename={getFilenameFromPath(activeBuffer.path)}
                    vimEnabled={vimEnabled}
                    vimMode={vimMode}
                    searchQuery={searchState.query}
                    searchMatches={searchState.matches}
                    currentMatchIndex={searchState.currentMatch - 1}
                    filePath={activeBuffer.path}
                    fontSize={settings.fontSize}
                    tabSize={settings.tabSize}
                    wordWrap={settings.wordWrap}
                    lineNumbers={settings.lineNumbers}
                    ref={codeEditorRef}
                    aiCompletion={settings.aiCompletion}
                    getCompletions={getCompletions || undefined}
                    getHover={getHover || undefined}
                    isLanguageSupported={isLanguageSupported || (() => false)}
                    openDocument={openDocument || undefined}
                    changeDocument={changeDocument || undefined}
                    closeDocument={closeDocument || undefined}
                  />
                )
              ) : (
                <div className="flex flex-1 items-center justify-center p-4 font-mono text-sm text-text-lighter">
                  Select a file to edit...
                </div>
              )}
            </div>

            {/* Right Side - File Tree (when sidebar is on right) or AI Chat (when sidebar is on left) */}
            {settings.sidebarPosition === "right"
              ? // File Tree on right when sidebar is on right
                uiState.isSidebarVisible && (
                  <ResizableRightPane
                    isVisible={true}
                    defaultWidth={220}
                    minWidth={200}
                    maxWidth={400}
                    position="right"
                  >
                    <MainSidebar
                      ref={searchViewRef}
                      onOpenExtensions={handleOpenExtensions}
                      onOpenFolder={handleOpenFolder}
                      onCreateNewFile={handleCreateNewFile}
                      onCreateNewFolderInDirectory={handleCreateNewFolderInDirectory}
                      onFileSelect={
                        isRemoteWindow
                          ? async (path: string, isDir: boolean) => {
                              if (isDir) {
                                await handleFolderToggle(path);
                              } else {
                                await remoteFileSelect(path, isDir, openBuffer);
                              }
                            }
                          : handleFileSelect
                      }
                      onCreateNewFileInDirectory={handleCreateNewFileInDirectory}
                      onDeletePath={handleDeletePath}
                      onUpdateFiles={setFilesCombined}
                      onProjectNameMenuOpen={contextMenus.handleProjectNameMenuOpen}
                      onRefreshDirectory={refreshDirectory}
                      onFileMove={handleFileMoveComplete}
                    />
                  </ResizableRightPane>
                )
              : // AI Chat on right when sidebar is on left
                coreFeatures.aiChat && (
                  <ResizableRightPane
                    isVisible={uiState.isRightPaneVisible}
                    defaultWidth={300}
                    minWidth={280}
                    maxWidth={600}
                    position="right"
                    width={aiChatWidth}
                    onWidthChange={setAIChatWidth}
                  >
                    <AIChat
                      activeBuffer={activeBuffer}
                      buffers={buffers}
                      rootFolderPath={rootFolderPath}
                      selectedFiles={[]}
                      allProjectFiles={allProjectFiles}
                      mode="chat"
                      onApplyCode={handleApplyCodeFromChat}
                    />
                  </ResizableRightPane>
                )}
          </div>

          {/* Bottom Pane */}
          <BottomPane
            isVisible={uiState.isBottomPaneVisible}
            onClose={() => {
              uiState.setIsBottomPaneVisible(false);
              setIsTerminalFullScreen(false);
            }}
            activeTab={uiState.bottomPaneActiveTab}
            onTabChange={tab => uiState.setBottomPaneActiveTab(tab)}
            diagnostics={diagnostics}
            onDiagnosticClick={handleDiagnosticClick}
            currentDirectory={rootFolderPath}
            showTerminal={coreFeatures.terminal}
            showDiagnostics={coreFeatures.diagnostics}
            onFullScreen={() => setIsTerminalFullScreen(prev => !prev)}
            isFullScreen={isTerminalFullScreen}
          />

          {/* Editor Footer */}
          <EditorFooter
            activeBuffer={activeBuffer}
            coreFeatures={coreFeatures}
            diagnostics={diagnostics}
            uiState={uiState}
            settings={settings}
          />

          {/* Command Bar */}
          <CommandBar
            isVisible={uiState.isCommandBarVisible}
            onClose={handleCommandBarClose}
            files={allProjectFiles}
            onFileSelect={handleCommandBarFileSelect}
            rootFolderPath={rootFolderPath}
          />

          {/* Command Palette */}
          <CommandPalette
            ref={commandPaletteRef}
            isVisible={uiState.isCommandPaletteVisible}
            onClose={handleCommandPaletteClose}
            onOpenSettings={() => {
              // Create settings JSON buffer with current values
              const settingsContent = JSON.stringify(
                {
                  ...settings,
                  maxOpenTabs: maxOpenTabs,
                },
                null,
                2,
              );
              openBuffer(
                "settings://user-settings.json",
                "settings.json",
                settingsContent,
                false,
                false,
                false,
                true,
              );
            }}
            onThemeChange={handleThemeChange}
            currentTheme={settings.theme}
            onQuickEditInline={handleQuickEdit}
            onToggleVimMode={toggleVimMode}
            vimEnabled={vimEnabled}
          />

          {/* GitHub Copilot Settings */}
          <GitHubCopilotSettings
            isVisible={uiState.isGitHubCopilotSettingsVisible}
            onClose={() => uiState.setIsGitHubCopilotSettingsVisible(false)}
          />

          {/* Quick Edit Inline */}
          <QuickEditInline
            isOpen={quickEdit.isOpen}
            onClose={handleQuickEditClose}
            onApplyEdit={handleQuickEditApply}
            selectedText={quickEdit.selectedText}
            cursorPosition={quickEdit.cursorPosition}
            filename={activeBuffer ? getFilenameFromPath(activeBuffer.path) : undefined}
            language={
              activeBuffer
                ? getLanguageFromFilename(getFilenameFromPath(activeBuffer.path))
                : undefined
            }
          />

          {/* Project Name Menu (Unified) */}
          <ProjectNameMenu
            projectNameMenu={uiState.projectNameMenu}
            recentFolders={recentFolders}
            onOpenFolder={handleOpenFolder}
            onCollapseAllFolders={handleCollapseAllFoldersComplete}
            onOpenRecentFolder={handleOpenRecentFolder}
            onCloseMenu={() => uiState.setProjectNameMenu(null)}
          />

          {/* Subtle reload notifications */}
          <FileReloadToast />
        </div>
      </div>
    </div>
  );
}

export default App;
