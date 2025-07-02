import { AlertCircle, Terminal as TerminalIcon } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import AIChat from "./components/ai-chat/ai-chat";
import BottomPane from "./components/bottom-pane";
import CodeEditor, { CodeEditorRef } from "./components/code-editor";
import CommandBar from "./components/command-bar";
import CommandPalette, { CommandPaletteRef } from "./components/command-palette";
import { Diagnostic } from "./components/diagnostics/diagnostics-pane";
import DiffViewer from "./components/diff-viewer";
import ExtensionsView from "./components/extensions-view";
import FindBar from "./components/find-bar";
import GitHubCopilotSettings from "./components/github-copilot-settings";
import ImageViewer from "./components/image-viewer";
import { MainSidebar } from "./components/layout/main-sidebar";
import QuickEditInline from "./components/quick-edit-modal";
import ResizableRightPane from "./components/resizable-right-pane";
import ResizableSidebar from "./components/resizable-sidebar";
import { SearchViewRef } from "./components/search-view";
import SQLiteViewer from "./components/sqlite-viewer";
import TabBar from "./components/tab-bar";
import CustomTitleBar from "./components/window/custom-title-bar";
import WelcomeScreen from "./components/window/welcome-screen";
import { createCoreFeaturesList, handleCoreFeatureToggle } from "./constants/core-features";
import { useBreadcrumbToggles } from "./hooks/use-breadcrumb-toggles";
import { useBuffers } from "./hooks/use-buffers";
import { ProjectNameMenu, useContextMenus } from "./hooks/use-context-menus";
import { useFileOperations } from "./hooks/use-file-operations";
import { useFileSelection } from "./hooks/use-file-selection";
import { useFolderOperations } from "./hooks/use-folder-operations";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useLSP } from "./hooks/use-lsp";
import { useMenuEvents } from "./hooks/use-menu-events";
import { useRecentFolders } from "./hooks/use-recent-folders";
import { useRemoteConnection } from "./hooks/use-remote-connection";
import { useSearch } from "./hooks/use-search";
import { useSettings } from "./hooks/use-settings";
import { useUIState } from "./hooks/use-ui-state";
import { useVim } from "./hooks/use-vim";
import { FileEntry } from "./types/app";
import { CoreFeaturesState, DEFAULT_CORE_FEATURES } from "./types/core-features";
import { ThemeType } from "./types/theme";
import { getFilenameFromPath, getLanguageFromFilename } from "./utils/file-utils";
import { GitDiff } from "./utils/git";
import { isMac, writeFile } from "./utils/platform";

function App() {
  const {
    isMinimapVisible,
    toggleOutline: _toggleOutline,
    toggleMinimap: _toggleMinimap,
    setIsOutlineVisible: _setIsOutlineVisible,
  } = useBreadcrumbToggles();

  // Use modular hooks
  const uiState = useUIState();
  const { settings, updateSetting, updateSettingsFromJSON } = useSettings();

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

  // State for all project files (for command palette)
  const [allProjectFiles, setAllProjectFiles] = useState<FileEntry[]>([]);

  // State for tab dragging across panes
  const [_isDraggingTab, setIsDraggingTab] = useState(false);

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
    refreshDirectory,
    handleCollapseAllFolders,
  } = useFileOperations({ openBuffer });

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
  }, [rootFolderPath, addToRecents]);

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
        const remotePath = "/" + pathParts.join("/");

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

    if (start === end) {
      const lines = textarea.value.split("\n");
      let currentPos = 0;
      let lineIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        if (currentPos + lines[i].length >= start) {
          lineIndex = i;
          break;
        }
        currentPos += lines[i].length + 1;
      }

      const lineStart = currentPos;
      const lineEnd = currentPos + lines[lineIndex].length;
      const lineText = lines[lineIndex];

      uiState.setQuickEditSelection({
        text: lineText,
        start: lineStart,
        end: lineEnd,
        cursorPosition: { x: cursorX, y: cursorY },
      });
    } else {
      uiState.setQuickEditSelection({
        text: selectedText,
        start,
        end,
        cursorPosition: { x: cursorX, y: cursorY },
      });
    }

    uiState.setIsQuickEditVisible(true);
  };

  const handleQuickEditApply = (editedText: string) => {
    if (!activeBuffer || !codeEditorRef.current?.textarea) return;

    const textarea = codeEditorRef.current.textarea;
    const { start, end } = uiState.quickEditSelection;

    // Replace the selected text with the edited text
    const newContent =
      activeBuffer.content.substring(0, start) + editedText + activeBuffer.content.substring(end);

    // Update the buffer content
    updateBufferContent(activeBuffer.id, newContent);

    // Update the textarea selection to show the new text - use requestAnimationFrame for immediate execution
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + editedText.length);
    });

    uiState.setIsQuickEditVisible(false);
  };

  const handleQuickEditClose = () => {
    uiState.setIsQuickEditVisible(false);
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
        if (!isNaN(lineNumber)) {
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
      alert("athas-code - A modern code editor built with Tauri and React");
    },
    onHelp: () => {
      console.log("Help triggered from menu");
    },
  });

  // Keyboard shortcuts
  useKeyboardShortcuts({
    setIsBottomPaneVisible: uiState.setIsBottomPaneVisible,
    setBottomPaneActiveTab: uiState.setBottomPaneActiveTab,
    setIsSidebarVisible: uiState.setIsSidebarVisible,
    setIsFindVisible,
    setIsRightPaneVisible: uiState.setIsRightPaneVisible,
    setIsCommandBarVisible: uiState.setIsCommandBarVisible,
    setIsCommandPaletteVisible: uiState.setIsCommandPaletteVisible,
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
    [activeBuffer, updateBufferContent, markBufferDirty, settings.autoSave],
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
    files.length === 0
    && !isRemoteWindow
    && !remoteConnectionId
    && !isRemoteFromUrl
    && !remoteParam;

  // Handle creating new folder
  const _handleCreateNewFolder = async () => {
    const folderName = prompt("Enter the name for the new folder:");
    if (!folderName) return;

    try {
      const newFolderPath = rootFolderPath ? `${rootFolderPath}/${folderName}` : folderName;

      // Create the directory by writing a placeholder file and then removing it
      // This is a workaround since create_directory might not be implemented
      const placeholderPath = `${newFolderPath}/.gitkeep`;
      await writeFile(placeholderPath, "");

      // Refresh the file tree
      await refreshDirectory(rootFolderPath || ".");
    } catch (error) {
      console.error("Error creating new folder:", error);
      alert("Failed to create folder. This feature may not be fully implemented yet.");
    }
  };

  if (shouldShowWelcome) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-transparent">
        <div
          className={`window-container flex flex-col h-full w-full bg-white overflow-hidden ${isMac() && "rounded-xl"}`}
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
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-transparent">
      <div
        className={`window-container flex flex-col h-full w-full bg-[var(--primary-bg)] overflow-hidden ${isMac() && "rounded-xl"}`}
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
        <div className="h-px bg-[var(--border-color)] flex-shrink-0" />

        {/* Main App Content */}
        <div className="flex flex-col h-full w-full bg-[var(--primary-bg)] overflow-hidden">
          <div className="flex flex-row flex-1 overflow-hidden custom-scrollbar-auto">
            {/* Left Sidebar */}
            {uiState.isSidebarVisible && (
              <ResizableSidebar defaultWidth={220} minWidth={180} maxWidth={400}>
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
            <div className="flex-1 flex flex-col bg-[var(--primary-bg)] h-full overflow-hidden">
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
              />

              {/* {!isSplitViewEnabled && activeBuffer && (
                <Breadcrumb
                  filePath={activeBuffer.path}
                  rootPath={rootFolderPath}
                  onNavigate={(path: string) => console.log("Navigate to:", path)}
                  isOutlineVisible={isOutlineVisible}
                  isMinimapVisible={isMinimapVisible}
                  onToggleOutline={() => {
                    if (isOutlineVisible) {
                      setIsOutlineVisible(false)
                      setIsRightPaneVisible(false)
                    } else {
                      setIsOutlineVisible(true)
                      setIsRightPaneVisible(true)
                    }
                  }}
                  onToggleMinimap={toggleMinimap}
                />
              )}
 */}
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
                <div className="flex items-center justify-center flex-1 p-4 text-[var(--text-lighter)] font-mono text-sm">
                  Select a file to edit...
                </div>
              )}

              {/* Footer with indicators */}
              <div className="flex items-center justify-between px-4 py-2 bg-[var(--secondary-bg)] min-h-[40px] border-t border-[var(--border-color)]">
                <div className="flex items-center gap-4 font-mono text-xs text-[var(--text-lighter)]">
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
                          !uiState.isBottomPaneVisible
                            || uiState.bottomPaneActiveTab !== "terminal",
                        );
                      }}
                      className={`flex items-center gap-1 px-2 py-1 border rounded transition-colors ${
                        uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "terminal"
                          ? "bg-[var(--selected-color)] border-[var(--border-color)] text-[var(--text-color)]"
                          : "bg-[var(--primary-bg)] border-[var(--border-color)] text-[var(--text-lighter)] hover:bg-[var(--hover-color)]"
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
                          !uiState.isBottomPaneVisible
                            || uiState.bottomPaneActiveTab !== "diagnostics",
                        );
                      }}
                      className={`flex items-center gap-1 px-2 py-1 border rounded transition-colors ${
                        uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "diagnostics"
                          ? "bg-[var(--selected-color)] border-[var(--border-color)] text-[var(--text-color)]"
                          : diagnostics.length > 0
                            ? "bg-[var(--primary-bg)] border-red-300 text-red-600 hover:bg-red-50"
                            : "bg-[var(--primary-bg)] border-[var(--border-color)] text-[var(--text-lighter)] hover:bg-[var(--hover-color)]"
                      }`}
                      title="Toggle Problems Panel"
                    >
                      <AlertCircle size={12} />
                      {diagnostics.length > 0 && (
                        <span className="text-xs rounded text-center leading-none">
                          {diagnostics.length}
                        </span>
                      )}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-4 font-mono text-xs text-[var(--text-lighter)]">
                  {activeBuffer && !activeBuffer.isSQLite && (
                    <button
                      onClick={() => uiState.setIsGitHubCopilotSettingsVisible(true)}
                      className="cursor-pointer flex items-center gap-1 px-2 py-1 bg-[var(--primary-bg)] border border-[var(--border-color)] rounded hover:bg-[var(--hover-color)] transition-colors"
                      title="AI Code Completion Settings"
                    >
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span>AI Assist</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right Pane */}
            {coreFeatures.aiChat && (
              <ResizableRightPane
                isVisible={uiState.isRightPaneVisible}
                defaultWidth={300}
                minWidth={200}
                maxWidth={600}
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
            currentDirectory={
              files.length > 0
                ? typeof files[0]?.path === "string"
                  ? files[0].path.split("/").slice(0, -1).join("/")
                  : undefined
                : undefined
            }
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
          />

          {/* GitHub Copilot Settings */}
          <GitHubCopilotSettings
            isVisible={uiState.isGitHubCopilotSettingsVisible}
            onClose={() => uiState.setIsGitHubCopilotSettingsVisible(false)}
          />

          {/* Quick Edit Inline */}
          <QuickEditInline
            isOpen={uiState.isQuickEditVisible}
            onClose={handleQuickEditClose}
            onApplyEdit={handleQuickEditApply}
            selectedText={uiState.quickEditSelection.text}
            cursorPosition={uiState.quickEditSelection.cursorPosition}
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
        </div>
      </div>
    </div>
  );
}

export default App;
