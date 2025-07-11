import { AlertCircle, ArrowLeftRight, Terminal as TerminalIcon } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import AIChat from "./components/ai-chat/ai-chat";
import BottomPane from "./components/bottom-pane";
import CodeEditor, { type CodeEditorRef } from "./components/code-editor";
import CommandBar from "./components/command-bar";
import CommandPalette, { type CommandPaletteRef } from "./components/command-palette";
import type { Diagnostic } from "./components/diagnostics/diagnostics-pane";
import DiffViewer from "./components/diff-viewer";
import BreadcrumbContainer from "./components/editor/breadcrumbs/breadcrumb-container";
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
import {
  cleanupFileWatcherListener,
  initializeFileWatcherListener,
  useFileWatcherStore,
} from "./store/file-watcher-store";
import { useUIState } from "./store/ui-state";
import type { FileEntry } from "./types/app";
import { type CoreFeaturesState, DEFAULT_CORE_FEATURES } from "./types/core-features";
import type { ThemeType } from "./types/theme";
import { getFilenameFromPath, getLanguageFromFilename } from "./utils/file-utils";
import type { GitDiff } from "./utils/git";
import { isMac, readFile, writeFile } from "./utils/platform";

function App() {
  const uiState = useUIState();
  const { settings, updateSetting, updateSettingsFromJSON } = useSettings();
  const quickEdit = useQuickEdit();

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

  // VIM functionality (moved here after useBuffers to access updateBufferContent)
  const {
    vimEnabled,
    vimMode,
    cursorPosition,
    setVimMode,
    setCursorPosition,
    toggleVimMode,
    handleVimKeyDown,
    updateCursorPosition,
  } = useVim({ activeBuffer, updateBufferContent, codeEditorRef });

  // Apply vim mode from settings
  useEffect(() => {
    if (settings.vimMode !== vimEnabled) {
      if (settings.vimMode) {
        // Enable vim mode if it's enabled in settings but not in vim hook
        // This would need to be handled by the vim hook itself
      }
    }
  }, [settings.vimMode, vimEnabled]);

  const [allProjectFiles, setAllProjectFiles] = useState<FileEntry[]>([]);
  const [_isDraggingTab, setIsDraggingTab] = useState(false);
  const [isMinimapVisible, setIsMinimapVisible] = useState(false);

  // File operations with proper callback
  const {
    files,
    setFiles,
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

  // File watcher store - get external changes as array
  const startWatching = useFileWatcherStore(state => state.startWatching);
  const markPendingSave = useFileWatcherStore(state => state.markPendingSave);
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
          .then(content => {
            updateBufferContent(buffer.id, content, false);
            // Dispatch event for toast notification
            window.dispatchEvent(new CustomEvent("file-reloaded", { detail: { path } }));
          })
          .catch(error => {
            console.error("❌ Failed to auto-reload file:", path, error);
          });
      }

      // If it's a directory change, refresh the file tree
      if (changeType === "modified" && rootFolderPath && path.startsWith(rootFolderPath)) {
        const dirPath = path.substring(0, path.lastIndexOf("/"));
        refreshDirectory(dirPath);
      }
    };

    window.addEventListener("file-external-change", handleFileExternalChange as any);

    return () => {
      window.removeEventListener("file-external-change", handleFileExternalChange as any);
    };
  }, [buffers, updateBufferContent, rootFolderPath, refreshDirectory]);

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
  } = useRemoteConnection(files, setFiles);

  // Unified folder operations (handles both local and remote)
  const { handleFolderToggle, handleCollapseAllFolders: handleCollapseAllFoldersComplete } =
    useFolderOperations({
      isRemoteWindow,
      remoteConnectionId,
      files,
      setFiles,
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

  // Get the project folder name from the root folder path
  const getProjectName = (): string => {
    if (isRemoteWindow && remoteConnectionName) {
      return remoteConnectionName;
    }

    if (uiState.isGitViewActive) {
      return "Source Control";
    }

    if (uiState.isSearchViewActive) {
      return "Search";
    }

    if (uiState.isRemoteViewActive) {
      return "Remote";
    }

    if (rootFolderPath) {
      // Extract the folder name from the full path

      const normalizedPath = rootFolderPath.replace(/\\/g, "/");
      const folderName = normalizedPath.split("/").pop();
      return folderName || "Folder";
    }

    return "Explorer";
  };

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
      console.log("Failed to open recent folder, falling back to dialog");
      await handleOpenFolder();
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
    if (!activeBuffer || !codeEditorRef.current?.textarea) return;

    const textarea = codeEditorRef.current.textarea;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    const textareaRect = textarea.getBoundingClientRect();
    const scrollLeft = textarea.scrollLeft;
    const scrollTop = textarea.scrollTop;

    const textBeforeCursor = textarea.value.substring(0, start);
    const lines = textBeforeCursor.split("\n");
    const currentLine = lines.length - 1;
    const currentColumn = lines[currentLine].length;

    const lineHeight = 20;
    const charWidth = 8;

    const cursorX = textareaRect.left + currentColumn * charWidth - scrollLeft;
    const cursorY = textareaRect.top + currentLine * lineHeight - scrollTop;

    let text = selectedText;
    let selectionRange = { start, end };

    if (start === end) {
      const linesArr = textarea.value.split("\n");
      let currentPos = 0;
      let lineIndex = 0;
      for (let i = 0; i < linesArr.length; i++) {
        if (currentPos + linesArr[i].length >= start) {
          lineIndex = i;
          break;
        }
        currentPos += linesArr[i].length + 1;
      }
      const lineStart = currentPos;
      const lineEnd = currentPos + linesArr[lineIndex].length;
      text = linesArr[lineIndex];
      selectionRange = { start: lineStart, end: lineEnd };
    }

    quickEdit.openQuickEdit({
      text,
      cursorPosition: { x: cursorX, y: cursorY },
      selectionRange,
    });
  };

  const handleQuickEditApply = (editedText: string) => {
    if (!activeBuffer || !codeEditorRef.current?.textarea) return;

    const textarea = codeEditorRef.current.textarea;
    const { start, end } = quickEdit.selectionRange;

    const newContent =
      activeBuffer.content.substring(0, start) + editedText + activeBuffer.content.substring(end);

    updateBufferContent(activeBuffer.id, newContent);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + editedText.length);
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

  const handleApplyCodeFromChat = (code: string) => {
    if (!activeBuffer || !codeEditorRef.current?.textarea) return;

    const textarea = codeEditorRef.current.textarea;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const newContent =
      activeBuffer.content.substring(0, start) + code + activeBuffer.content.substring(end);

    updateBufferContent(activeBuffer.id, newContent);

    requestAnimationFrame(() => {
      textarea.focus();
      const newCursorPosition = start + code.length;
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
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
      if (codeEditorRef.current?.textarea) {
        document.execCommand("undo");
      }
    },
    onRedo: () => {
      if (codeEditorRef.current?.textarea) {
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
      if (line && codeEditorRef.current?.textarea) {
        const lineNumber = parseInt(line, 10);
        if (!Number.isNaN(lineNumber)) {
          const textarea = codeEditorRef.current.textarea;
          const lines = textarea.value.split("\n");
          let targetPosition = 0;

          for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
            targetPosition += lines[i].length + 1;
          }

          textarea.focus();
          textarea.setSelectionRange(targetPosition, targetPosition);
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

  useEffect(() => {
    const handleNavigateToLine = (event: CustomEvent) => {
      const { line } = event.detail;
      if (codeEditorRef.current?.textarea) {
        const textarea = codeEditorRef.current.textarea;
        const lines = textarea.value.split("\n");
        let targetPosition = 0;

        for (let i = 0; i < line - 1 && i < lines.length; i++) {
          targetPosition += lines[i].length + 1;
        }

        textarea.focus();
        textarea.setSelectionRange(targetPosition, targetPosition);
        const lineHeight = 20;
        const scrollTop = Math.max(0, (line - 1) * lineHeight - textarea.clientHeight / 2);
        textarea.scrollTop = scrollTop;
      }
    };

    window.addEventListener("navigate-to-line", handleNavigateToLine as any);
    return () => {
      window.removeEventListener("navigate-to-line", handleNavigateToLine as any);
    };
  }, []);

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
    if (codeEditorRef.current?.textarea) {
      const textarea = codeEditorRef.current.textarea;
      const lines = textarea.value.split("\n");
      let targetPosition = 0;

      for (let i = 0; i < diagnostic.line - 1 && i < lines.length; i++) {
        targetPosition += lines[i].length + 1;
      }
      targetPosition += diagnostic.column - 1;

      textarea.focus();
      textarea.setSelectionRange(targetPosition, targetPosition);
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
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-transparent">
        <div
          className={`window-container flex h-full w-full flex-col overflow-hidden bg-white ${isMac() && "rounded-xl"}`}
        >
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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-transparent">
      <div
        className={`window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg ${isMac() && "rounded-xl"}`}
      >
        {/* Custom Titlebar */}
        <CustomTitleBar
          projectName={getProjectName() !== "Explorer" ? getProjectName() : undefined}
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
                  >
                    <AIChat
                      activeBuffer={activeBuffer}
                      buffers={buffers}
                      rootFolderPath={rootFolderPath}
                      selectedFiles={[]}
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
                      isGitViewActive={uiState.isGitViewActive}
                      isSearchViewActive={uiState.isSearchViewActive}
                      isRemoteViewActive={uiState.isRemoteViewActive}
                      isRemoteWindow={isRemoteWindow}
                      remoteConnectionName={remoteConnectionName || undefined}
                      coreFeatures={coreFeatures}
                      files={files}
                      rootFolderPath={rootFolderPath}
                      allProjectFiles={allProjectFiles}
                      activeBufferPath={activeBuffer?.path}
                      onViewChange={uiState.setActiveView}
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
                      onDeletePath={(path: string) => handleDeletePath(path, false)}
                      onProjectNameMenuOpen={contextMenus.handleProjectNameMenuOpen}
                      projectName={getProjectName()}
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
                    setIsRightPaneVisible={uiState.setIsRightPaneVisible}
                    onMinimapStateChange={setIsMinimapVisible}
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
                    cursorPosition={cursorPosition}
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
                    minimap={isMinimapVisible}
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

              {/* Footer with indicators */}
              <div className="flex min-h-[40px] items-center justify-between border-border border-t bg-secondary-bg px-4 py-2">
                <div className="flex items-center gap-4 font-mono text-text-lighter text-xs">
                  {activeBuffer && (
                    <>
                      <span>{activeBuffer.content.split("\n").length} lines</span>
                      {(() => {
                        const language = getLanguageFromFilename(
                          getFilenameFromPath(activeBuffer.path),
                        );
                        return language !== "Text" && <span>{language}</span>;
                      })()}
                    </>
                  )}

                  {/* Terminal indicator */}
                  {coreFeatures.terminal && (
                    <button
                      onClick={() => {
                        uiState.setBottomPaneActiveTab("terminal");
                        uiState.setIsBottomPaneVisible(
                          !uiState.isBottomPaneVisible ||
                            uiState.bottomPaneActiveTab !== "terminal",
                        );
                      }}
                      className={`flex items-center gap-1 rounded border px-2 py-1 transition-colors ${
                        uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "terminal"
                          ? "border-border bg-selected text-text"
                          : "border-border bg-primary-bg text-text-lighter hover:bg-hover"
                      }`}
                      title="Toggle Terminal"
                    >
                      <TerminalIcon size={12} />
                    </button>
                  )}

                  {/* Diagnostics indicator */}
                  {coreFeatures.diagnostics && (
                    <button
                      onClick={() => {
                        uiState.setBottomPaneActiveTab("diagnostics");
                        uiState.setIsBottomPaneVisible(
                          !uiState.isBottomPaneVisible ||
                            uiState.bottomPaneActiveTab !== "diagnostics",
                        );
                      }}
                      className={`flex items-center gap-1 rounded border px-2 py-1 transition-colors ${
                        uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "diagnostics"
                          ? "border-border bg-selected text-text"
                          : diagnostics.length > 0
                            ? "border-red-300 bg-primary-bg text-red-600 hover:bg-red-50"
                            : "border-border bg-primary-bg text-text-lighter hover:bg-hover"
                      }`}
                      title="Toggle Problems Panel"
                    >
                      <AlertCircle size={12} />
                      {diagnostics.length > 0 && (
                        <span className="rounded text-center text-xs leading-none">
                          {diagnostics.length}
                        </span>
                      )}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-4 font-mono text-text-lighter text-xs">
                  {/* Sidebar Position Toggle */}
                  <button
                    onClick={handleToggleSidebarPosition}
                    className="flex cursor-pointer items-center gap-1 rounded border border-border bg-primary-bg px-2 py-1 transition-colors hover:bg-hover"
                    title={`Switch sidebar to ${settings.sidebarPosition === "left" ? "right" : "left"} (Cmd+Shift+B)`}
                  >
                    <ArrowLeftRight size={12} />
                  </button>

                  {activeBuffer && !activeBuffer.isSQLite && (
                    <button
                      onClick={() => uiState.setIsGitHubCopilotSettingsVisible(true)}
                      className="flex cursor-pointer items-center gap-1 rounded border border-border bg-primary-bg px-2 py-1 transition-colors hover:bg-hover"
                      title="AI Code Completion Settings"
                    >
                      <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
                      <span>AI Assist</span>
                    </button>
                  )}
                </div>
              </div>
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
                      isGitViewActive={uiState.isGitViewActive}
                      isSearchViewActive={uiState.isSearchViewActive}
                      isRemoteViewActive={uiState.isRemoteViewActive}
                      isRemoteWindow={isRemoteWindow}
                      remoteConnectionName={remoteConnectionName || undefined}
                      coreFeatures={coreFeatures}
                      files={files}
                      rootFolderPath={rootFolderPath}
                      allProjectFiles={allProjectFiles}
                      activeBufferPath={activeBuffer?.path}
                      onViewChange={uiState.setActiveView}
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
                      onDeletePath={(path: string) => handleDeletePath(path, false)}
                      onProjectNameMenuOpen={contextMenus.handleProjectNameMenuOpen}
                      projectName={getProjectName()}
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
                  >
                    <AIChat
                      activeBuffer={activeBuffer}
                      buffers={buffers}
                      rootFolderPath={rootFolderPath}
                      selectedFiles={[]}
                      mode="chat"
                      onApplyCode={handleApplyCodeFromChat}
                    />
                  </ResizableRightPane>
                )}
          </div>

          {/* Bottom Pane */}
          <BottomPane
            isVisible={uiState.isBottomPaneVisible}
            onClose={() => uiState.setIsBottomPaneVisible(false)}
            activeTab={uiState.bottomPaneActiveTab}
            onTabChange={tab => uiState.setBottomPaneActiveTab(tab)}
            diagnostics={diagnostics}
            onDiagnosticClick={handleDiagnosticClick}
            currentDirectory={rootFolderPath}
            showTerminal={coreFeatures.terminal}
            showDiagnostics={coreFeatures.diagnostics}
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
            onQuickEditInline={handleQuickEdit}
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
