import {
  AlertCircle,
  Bug,
  FilePlus,
  Folder,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Package,
  Search,
  Server,
  Terminal as TerminalIcon,
} from "lucide-react";

import { readFile, writeFile, isMac } from "./utils/platform";
import { BottomPaneTab, QuickEditSelection } from "./types/ui-state";
import CodeEditor, { CodeEditorRef } from "./components/code-editor";
import CommandPalette, { CommandPaletteRef } from "./components/command-palette";
import { CoreFeature, CoreFeaturesState, DEFAULT_CORE_FEATURES } from "./types/core-features";
import SearchView, { SearchViewRef } from "./components/search-view";
import {
  getFilenameFromPath,
  getLanguageFromFilename,
  isImageFile,
  isSQLiteFile,
} from "./utils/file-utils";
import { useCallback, useEffect, useRef, useState } from "react";

import AIChat from "./components/ai-chat/ai-chat";
import BottomPane from "./components/bottom-pane";
import Button from "./components/button";
import CommandBar from "./components/command-bar";
import CustomTitleBar from "./components/window/custom-title-bar";
import { Diagnostic } from "./components/diagnostics-pane";
import DiffViewer from "./components/diff-viewer";
import ExtensionsView from "./components/extensions-view";
import { FileEntry } from "./types/app";
import FileTree from "./components/file-tree";
import FindBar from "./components/find-bar";
import { GitDiff } from "./utils/git";
import GitHubCopilotSettings from "./components/github-copilot-settings";
import GitView from "./components/git-view";
import ImageGenerationModal from "./components/image-generation-modal";
import ImageViewer from "./components/image-viewer";
import QuickEditInline from "./components/quick-edit-modal";
import { RecentFolder } from "./types/recent-folders";
import RemoteConnectionView from "./components/remote/remote-connection-view";
import ResizableRightPane from "./components/resizable-right-pane";
import ResizableSidebar from "./components/resizable-sidebar";
import SQLiteViewer from "./components/sqlite-viewer";
import TabBar from "./components/tab-bar";
import { ThemeType } from "./types/theme";
import WelcomeScreen from "./components/welcome-screen";
import { useBreadcrumbToggles } from "./hooks/use-breadcrumb-toggles";
import { useBuffers } from "./hooks/use-buffers";
import { useFileOperations } from "./hooks/use-file-operations";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useLSP } from "./hooks/use-lsp";
import { useMenuEvents } from "./hooks/use-menu-events";
import { useRemoteConnection } from "./hooks/use-remote-connection";
import { useSearch } from "./hooks/use-search";
import { useVim } from "./hooks/use-vim";

function App() {
  const {
    isOutlineVisible,
    isMinimapVisible,
    toggleOutline,
    toggleMinimap,
    setIsOutlineVisible
  } = useBreadcrumbToggles()

  // UI State
  const [isSidebarVisible, setIsSidebarVisible] = useState<boolean>(true);
  const [isRightPaneVisible, setIsRightPaneVisible] = useState<boolean>(false);
  const [isCommandBarVisible, setIsCommandBarVisible] =
    useState<boolean>(false);
  const [isCommandPaletteVisible, setIsCommandPaletteVisible] =
    useState<boolean>(false);

  const [isGitViewActive, setIsGitViewActive] = useState<boolean>(false);
  const [isSearchViewActive, setIsSearchViewActive] = useState<boolean>(false);
  const [isRemoteViewActive, setIsRemoteViewActive] = useState<boolean>(false);
  const [isGitHubCopilotSettingsVisible, setIsGitHubCopilotSettingsVisible] =
    useState<boolean>(false);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [isBottomPaneVisible, setIsBottomPaneVisible] =
    useState<boolean>(false);
  const [bottomPaneActiveTab, setBottomPaneActiveTab] = useState<BottomPaneTab>("terminal");
  const [currentTheme, setCurrentTheme] = useState<ThemeType>(() => {
    const savedTheme = localStorage.getItem("athas-code-theme");
    return (savedTheme as ThemeType) || "auto";
  });
  const [fontSize, setFontSize] = useState<number>(14);
  const [tabSize, setTabSize] = useState<number>(2);
  const [wordWrap, setWordWrap] = useState<boolean>(true);
  const [lineNumbers, setLineNumbers] = useState<boolean>(true);
  const [autoSave, setAutoSave] = useState<boolean>(true);
  const [vimModeEnabled, setVimModeEnabled] = useState<boolean>(false);
  const [aiCompletion, setAiCompletion] = useState<boolean>(true);
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

  const [isQuickEditVisible, setIsQuickEditVisible] = useState<boolean>(false);
  const [quickEditSelection, setQuickEditSelection] = useState<QuickEditSelection>({
    text: "",
    start: 0,
    end: 0,
    cursorPosition: { x: 0, y: 0 }
  });

  // State for folder header context menu
  const [folderHeaderContextMenu, setFolderHeaderContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // State for project name menu (unified for both left and right click)
  const [projectNameMenu, setProjectNameMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const codeEditorRef = useRef<CodeEditorRef>(null);
  const searchViewRef = useRef<SearchViewRef>(null);
  const commandPaletteRef = useRef<CommandPaletteRef>(null);

  // Apply platform-specific CSS class on mount
  useEffect(() => {
    if (isMac()) {
      document.documentElement.classList.add('platform-macos');
    } else {
      document.documentElement.classList.add('platform-other');
    }

    // Cleanup on unmount
    return () => {
      document.documentElement.classList.remove('platform-macos', 'platform-other');
    };
  }, []);

  // Load recent folders from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("athas-code-recent-folders");
    if (stored) {
      try {
        setRecentFolders(JSON.parse(stored));
      } catch (error) {
        console.error("Error loading recent folders:", error);
      }
    }
  }, []);



  // Save recent folders to localStorage
  const saveRecentFolders = (folders: RecentFolder[]) => {
    try {
      localStorage.setItem(
        "athas-code-recent-folders",
        JSON.stringify(folders),
      );
      setRecentFolders(folders);
    } catch (error) {
      console.error("Error saving recent folders:", error);
    }
  };

  // Handle core feature toggle
  const handleCoreFeatureToggle = (featureId: string, enabled: boolean) => {
    const newFeatures = { ...coreFeatures, [featureId]: enabled };
    setCoreFeatures(newFeatures);
    try {
      localStorage.setItem("athas-code-core-features", JSON.stringify(newFeatures));
    } catch (error) {
      console.error("Error saving core features:", error);
    }
  };

  // Create core features array for extensions view
  const coreFeaturesList: CoreFeature[] = [
    {
      id: "git",
      name: "Git Integration",
      description: "Source control management with Git repositories",
      icon: GitBranch,
      enabled: coreFeatures.git,
    },
    {
      id: "remote",
      name: "Remote Development",
      description: "Connect to remote servers via SSH",
      icon: Server,
      enabled: coreFeatures.remote,
    },
    {
      id: "terminal",
      name: "Integrated Terminal",
      description: "Built-in terminal for command line operations",
      icon: TerminalIcon,
      enabled: coreFeatures.terminal,
    },
    {
      id: "search",
      name: "Global Search",
      description: "Search across files and folders in workspace",
      icon: Search,
      enabled: coreFeatures.search,
    },
    {
      id: "diagnostics",
      name: "Diagnostics & Problems",
      description: "Code diagnostics and error reporting",
      icon: Bug,
      enabled: coreFeatures.diagnostics,
    },
    {
      id: "aiChat",
      name: "AI Assistant",
      description: "AI-powered code assistance and chat",
      icon: MessageSquare,
      enabled: coreFeatures.aiChat,
    },
  ];

  // Add a folder to recents
  const addToRecents = (folderPath: string) => {
    const folderName = folderPath.split("/").pop() || folderPath;
    const now = new Date();
    const timeString = now.toLocaleString();

    const newFolder: RecentFolder = {
      name: folderName,
      path: folderPath,
      lastOpened: timeString,
    };

    const updatedRecents = [
      newFolder,
      ...recentFolders.filter((f) => f.path !== folderPath),
    ].slice(0, 5); // Keep only 5 most recent

    saveRecentFolders(updatedRecents);
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

  // State for all project files (for command palette)
  const [allProjectFiles, setAllProjectFiles] = useState<FileEntry[]>([]);

  // State for tab dragging across panes
  const [isDraggingTab, setIsDraggingTab] = useState(false);

  // File operations with proper callback
  const {
    files,
    setFiles,
    rootFolderPath,
    getAllProjectFiles,
    handleOpenFolder,
    handleFolderToggle: localHandleFolderToggle,
    handleCreateNewFile,
    handleCreateNewFileInDirectory,
    refreshDirectory,
    handleCollapseAllFolders,
  } = useFileOperations({ openBuffer });

  // Function to refresh all project files (needed by remote connection hook)
  const refreshAllProjectFiles = useCallback(async () => {
    console.log("refreshAllProjectFiles called:", {
      rootFolderPath,
    });

    if (rootFolderPath && getAllProjectFiles) {
      try {
        console.log("Refreshing local project files...");
        const projectFiles = await getAllProjectFiles();
        console.log(`Setting ${projectFiles.length} local project files`);
        setAllProjectFiles(projectFiles);
      } catch (error) {
        console.error("Error refreshing all project files:", error);
      }
    } else {
      console.log("No conditions met for refreshing project files");
    }
  }, [rootFolderPath, getAllProjectFiles]);

  // Remote connection management
  const {
    isRemoteWindow,
    remoteConnectionId,
    remoteConnectionName,
    handleRemoteFileSelect: remoteFileSelect,
  } = useRemoteConnection(files, setFiles);



  // LSP integration (after rootFolderPath is available)
  const {
    openDocument,
    changeDocument,
    closeDocument,
    getCompletions,
    getHover,
    isLanguageSupported,
    isReady,
  } = useLSP({
    workspaceRoot: rootFolderPath || undefined,
    onDiagnostics: (diagnostics) => {
      setDiagnostics(diagnostics);
    },
  });

  // Function to refresh all project files - handles only local files (remote has no indexing)
  const refreshAllProjectFilesComplete = useCallback(async () => {
    console.log("refreshAllProjectFiles called:", {
      isRemoteWindow,
      rootFolderPath,
    });

    if (!isRemoteWindow) {
      // Handle local files only - remote files are browsed directly without indexing
      refreshAllProjectFiles();
    } else {
      // For remote connections, no project-wide file indexing
      setAllProjectFiles([]);
    }
  }, [
    rootFolderPath,
    isRemoteWindow,
    refreshAllProjectFiles,
  ]);

  // Load all project files when root folder changes or remote connection changes
  useEffect(() => {
    refreshAllProjectFilesComplete();
  }, [refreshAllProjectFilesComplete]);

  // Get the project folder name from the root folder path
  const getProjectName = (): string => {
    if (isRemoteWindow && remoteConnectionName) {
      return remoteConnectionName;
    }

    if (isGitViewActive) {
      return "Source Control";
    }

    if (isSearchViewActive) {
      return "Search";
    }

    if (isRemoteViewActive) {
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
    // Create a virtual Extensions buffer
    openBuffer(
      "extensions://language-servers",
      "Extensions",
      "", // Empty content since it's handled by the component
      false, // not SQLite
      false, // not image
      false, // not diff
      true, // is virtual
    );
  };

  // Custom folder toggle that works with both local and remote files
  const handleFolderToggle = useCallback(
    async (folderPath: string) => {
      if (isRemoteWindow && remoteConnectionId) {
        // Handle remote folder toggle
        const updateFiles = async (
          items: FileEntry[],
        ): Promise<FileEntry[]> => {
          return Promise.all(
            items.map(async (item) => {
              if (item.path === folderPath && item.isDir) {
                if (!item.expanded) {
                  // Expand folder - load children from remote
                  try {
                    const { invoke } = await import("@tauri-apps/api/core");
                    const remoteFiles = await invoke<any[]>(
                      "ssh_list_directory",
                      {
                        connectionId: remoteConnectionId,
                        path: item.path,
                      },
                    );

                    const children: FileEntry[] = remoteFiles.map((file) => ({
                      name: file.name,
                      path: file.path,
                      isDir: file.is_dir,
                      expanded: false,
                      children: undefined,
                    }));

                    return { ...item, expanded: true, children };
                  } catch (error) {
                    console.error("Error reading remote directory:", error);
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
      } else {
        // Use local folder toggle
        await localHandleFolderToggle(folderPath);
      }
    },
    [
      isRemoteWindow,
      remoteConnectionId,
      files,
      setFiles,
      localHandleFolderToggle,
    ],
  );

  // Collapse all folders (works for both local and remote)
  const handleCollapseAllFoldersComplete = useCallback(() => {
    if (isRemoteWindow && remoteConnectionId) {
      // Handle remote collapse all
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
    } else {
      // Use local collapse all
      handleCollapseAllFolders();
    }
  }, [isRemoteWindow, remoteConnectionId, files, setFiles, handleCollapseAllFolders]);



  // Track when a new folder is opened and add to recents
  useEffect(() => {
    if (rootFolderPath) {
      addToRecents(rootFolderPath);
    }
  }, [rootFolderPath]);

  // Add mock diagnostics for testing
  useEffect(() => {
    if (activeBuffer && activeBuffer.path.endsWith(".rb")) {
      const mockDiagnostics: Diagnostic[] = [
        {
          severity: "error",
          line: 5,
          column: 10,
          message: "Undefined variable `user`",
          source: "ruby-lsp",
          code: "undefined_variable",
        },
        {
          severity: "warning",
          line: 12,
          column: 5,
          message: "Unused variable `temp`",
          source: "ruby-lsp",
          code: "unused_variable",
        },
        {
          severity: "info",
          line: 20,
          column: 1,
          message: "Consider using a more descriptive variable name",
          source: "rubocop",
        },
      ];
      handleDiagnosticsUpdate(mockDiagnostics);
    } else {
      setDiagnostics([]);
    }
  }, [activeBuffer]);

  // Handle opening a recent folder
  const handleOpenRecentFolder = async (path: string) => {
    // In a real implementation, you would open the specific folder path
    // For now, we'll just trigger the open folder dialog and update recents
    console.log("Opening recent folder:", path);
    addToRecents(path);
    await handleOpenFolder();
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
      // Handle virtual file saves
      if (activeBuffer.path === "settings://user-settings.json") {
        // Apply settings on save
        try {
          const settings = JSON.parse(activeBuffer.content);

          // Apply all settings
          if (settings.theme !== undefined) {
            handleThemeChange(settings.theme);
          }
          if (settings.fontSize !== undefined) {
            setFontSize(settings.fontSize);
          }
          if (settings.tabSize !== undefined) {
            setTabSize(settings.tabSize);
          }
          if (settings.wordWrap !== undefined) {
            setWordWrap(settings.wordWrap);
          }
          if (settings.lineNumbers !== undefined) {
            setLineNumbers(settings.lineNumbers);
          }
          if (settings.autoSave !== undefined) {
            setAutoSave(settings.autoSave);
          }
          if (settings.vimMode !== undefined) {
            setVimModeEnabled(settings.vimMode);
          }
          if (settings.aiCompletion !== undefined) {
            setAiCompletion(settings.aiCompletion);
          }

          markBufferDirty(activeBuffer.id, false);
          console.log("Settings applied successfully");
        } catch (error) {
          console.error("Invalid settings JSON:", error);
          markBufferDirty(activeBuffer.id, true);
        }
      } else {
        // Other virtual files - just mark as clean
        markBufferDirty(activeBuffer.id, false);
      }
    } else {
      // Regular files - save to disk
      if (activeBuffer.path.startsWith("remote://")) {
        // For remote files, mark as dirty first, then save directly via SSH
        markBufferDirty(activeBuffer.id, true);

        const pathParts = activeBuffer.path
          .replace("remote://", "")
          .split("/");
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
        // Local files - save directly
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

    // Get cursor position relative to viewport
    const textareaRect = textarea.getBoundingClientRect();
    const scrollLeft = textarea.scrollLeft;
    const scrollTop = textarea.scrollTop;

    // Calculate approximate cursor position within textarea
    const textBeforeCursor = textarea.value.substring(0, start);
    const lines = textBeforeCursor.split("\n");
    const currentLine = lines.length - 1;
    const currentColumn = lines[currentLine].length;

    // Rough estimation of character position (this could be improved with better calculation)
    const lineHeight = 20; // Approximate line height
    const charWidth = 8; // Approximate character width

    const cursorX = textareaRect.left + currentColumn * charWidth - scrollLeft;
    const cursorY = textareaRect.top + currentLine * lineHeight - scrollTop;

    // If no text is selected, select the current line
    if (start === end) {
      const lines = textarea.value.split("\n");
      let currentPos = 0;
      let lineIndex = 0;

      // Find which line the cursor is on
      for (let i = 0; i < lines.length; i++) {
        if (currentPos + lines[i].length >= start) {
          lineIndex = i;
          break;
        }
        currentPos += lines[i].length + 1; // +1 for newline
      }

      const lineStart = currentPos;
      const lineEnd = currentPos + lines[lineIndex].length;
      const lineText = lines[lineIndex];

      setQuickEditSelection({
        text: lineText,
        start: lineStart,
        end: lineEnd,
        cursorPosition: { x: cursorX, y: cursorY },
      });
    } else {
      setQuickEditSelection({
        text: selectedText,
        start,
        end,
        cursorPosition: { x: cursorX, y: cursorY },
      });
    }

    setIsQuickEditVisible(true);
  };

  const handleQuickEditApply = (editedText: string) => {
    if (!activeBuffer || !codeEditorRef.current?.textarea) return;

    const textarea = codeEditorRef.current.textarea;
    const { start, end } = quickEditSelection;

    // Replace the selected text with the edited text
    const newContent =
      activeBuffer.content.substring(0, start) +
      editedText +
      activeBuffer.content.substring(end);

    // Update the buffer content
    updateBufferContent(activeBuffer.id, newContent);

    // Update the textarea selection to show the new text - use requestAnimationFrame for immediate execution
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + editedText.length);
    });

    setIsQuickEditVisible(false);
  };

  const handleQuickEditClose = () => {
    setIsQuickEditVisible(false);
  };

  const handleApplyCodeFromChat = (code: string) => {
    if (!activeBuffer || !codeEditorRef.current?.textarea) return;

    const textarea = codeEditorRef.current.textarea;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // If text is selected, replace it. Otherwise, insert at cursor position
    const newContent =
      activeBuffer.content.substring(0, start) +
      code +
      activeBuffer.content.substring(end);

    // Update the buffer content
    updateBufferContent(activeBuffer.id, newContent);

    // Focus and position cursor after inserted code - use requestAnimationFrame for immediate execution
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
      setIsCommandPaletteVisible(true);
    },
    onToggleSidebar: () => {
      setIsSidebarVisible(!isSidebarVisible);
    },
    onToggleTerminal: () => {
      setBottomPaneActiveTab("terminal");
      setIsBottomPaneVisible(
        !isBottomPaneVisible || bottomPaneActiveTab !== "terminal",
      );
    },
    onToggleAiChat: () => {
      setIsRightPaneVisible(!isRightPaneVisible);
    },
    onSplitEditor: () => {
      console.log("Split editor triggered from menu");
      // TODO: Implement split editor functionality
    },
    onToggleVim: () => {
      toggleVimMode();
    },
    onGoToFile: () => {
      setIsCommandBarVisible(true);
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
    setIsBottomPaneVisible,
    setBottomPaneActiveTab,
    setIsSidebarVisible,
    setIsFindVisible,
    setIsRightPaneVisible,
    setIsCommandBarVisible,
    setIsCommandPaletteVisible,
    setIsSearchViewActive,
    focusSearchInput,
    focusCommandPalette,
    activeBuffer,
    closeBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    buffers,
    setActiveBuffer,
    isBottomPaneVisible,
    bottomPaneActiveTab,
    onSave: handleSave,
    onQuickEdit: handleQuickEdit,
    coreFeatures,
  });



  // Handle clicking outside context menu to close it
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      setFolderHeaderContextMenu(null);
      setProjectNameMenu(null);
    };

    if (folderHeaderContextMenu || projectNameMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [folderHeaderContextMenu, projectNameMenu]);

  useEffect(() => {
    const handleNavigateToLine = (event: CustomEvent) => {
      const { line } = event.detail
      if (codeEditorRef.current?.textarea) {
        const textarea = codeEditorRef.current.textarea
        const lines = textarea.value.split('\n')
        let targetPosition = 0

        for (let i = 0; i < line - 1 && i < lines.length; i++) {
          targetPosition += lines[i].length + 1
        }

        textarea.focus()
        textarea.setSelectionRange(targetPosition, targetPosition)
        const lineHeight = 20
        const scrollTop = Math.max(0, (line - 1) * lineHeight - textarea.clientHeight / 2)
        textarea.scrollTop = scrollTop
      }
    }

    window.addEventListener('navigate-to-line', handleNavigateToLine as EventListener)
    return () => {
      window.removeEventListener('navigate-to-line', handleNavigateToLine as EventListener)
    }
  }, [])

  const handleFileSelect = async (
    path: string,
    isDir: boolean,
    line?: number,
    column?: number,
  ) => {
    if (isDir) {
      handleFolderToggle(path);
      return;
    }

    const fileName = getFilenameFromPath(path);

    // Handle virtual diff files
    if (path.startsWith("diff://")) {
      const diffContent = localStorage.getItem(`diff-content-${path}`);
      if (diffContent) {
        openBuffer(path, fileName, diffContent, false, false, true, true); // Mark as diff and virtual
        return;
      } else {
        openBuffer(
          path,
          fileName,
          "No diff content available",
          false,
          false,
          true,
          true,
        );
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
        openBuffer(path, fileName, safeContent, false, false, false, false);

        // Navigate to specific line/column if provided
        if (line && column) {
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
                targetPosition += Math.min(
                  column - 1,
                  lines[line - 1]?.length || 0,
                );
              }

              textarea.focus();
              textarea.setSelectionRange(targetPosition, targetPosition);

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
        if (vimEnabled) {
          setVimMode("normal");
          // Update cursor position immediately after vim mode change
          requestAnimationFrame(() => {
            updateCursorPosition();
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
  };

  // Immediate buffer update for responsive typing - NO auto-saving for remote files
  const handleContentChange = useCallback((content: string) => {
    if (!activeBuffer) return;

    const isRemoteFile = activeBuffer.path.startsWith("remote://");

    if (isRemoteFile) {
      // For remote files, use direct synchronous update to avoid any React delays
      updateBufferContent(activeBuffer.id, content, false);
    } else {
      // For local files, update content and auto-save
      updateBufferContent(activeBuffer.id, content, true);
      if (!activeBuffer.isVirtual) {
        // Auto-save local files with small debounce
        setTimeout(async () => {
          try {
            await writeFile(activeBuffer.path, content);
            markBufferDirty(activeBuffer.id, false);
          } catch (error) {
            console.error("Error saving local file:", error);
            markBufferDirty(activeBuffer.id, true);
          }
        }, 100);
      }
    }
  }, [activeBuffer, updateBufferContent, markBufferDirty]);

  const handleTabClick = (bufferId: string) => {
    setActiveBuffer(bufferId);
  };

  const handleTabClose = (bufferId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    closeBuffer(bufferId);
  };

  const handleTabPin = (bufferId: string) => {
    const buffer = buffers.find((b) => b.id === bufferId);
    if (buffer) {
      updateBuffer({
        ...buffer,
        isPinned: !buffer.isPinned,
      });
    }
  };

  const handleCloseOtherTabs = (keepBufferId: string) => {
    const buffersToClose = buffers.filter(
      (b) => b.id !== keepBufferId && !b.isPinned,
    );
    buffersToClose.forEach((buffer) => closeBuffer(buffer.id));
  };

  const handleCloseAllTabs = () => {
    const buffersToClose = buffers.filter((b) => !b.isPinned);
    buffersToClose.forEach((buffer) => closeBuffer(buffer.id));
  };

  const handleCloseTabsToRight = (bufferId: string) => {
    const bufferIndex = buffers.findIndex((b) => b.id === bufferId);
    if (bufferIndex === -1) return;

    const buffersToClose = buffers
      .slice(bufferIndex + 1)
      .filter((b) => !b.isPinned);
    buffersToClose.forEach((buffer) => closeBuffer(buffer.id));
  };

  // Split view handlers (simplified for performance)
  // Handle tab drag start
  const handleTabDragStart = (bufferId: string, paneId?: string) => {
    setIsDraggingTab(true);
  };

  // Handle tab drag end
  const handleTabDragEnd = () => {
    setIsDraggingTab(false);
  };

  // Command bar handlers
  const handleCommandBarClose = () => {
    setIsCommandBarVisible(false);
  };

  const handleCommandBarFileSelect = async (path: string) => {
    await handleFileSelect(path, false);
    setIsCommandBarVisible(false);
  };

  // Command palette handlers
  const handleCommandPaletteClose = () => {
    setIsCommandPaletteVisible(false);
  };

  const handleThemeChange = (theme: ThemeType) => {
    setCurrentTheme(theme);
    localStorage.setItem("athas-code-theme", theme);

    // Apply theme to document
    const html = document.documentElement;
    html.classList.remove(
      "force-light",
      "force-dark",
      "force-midnight",
      "force-catppuccin-mocha",
      "force-catppuccin-macchiato",
      "force-catppuccin-frappe",
      "force-catppuccin-latte",
      "force-tokyo-night",
      "force-tokyo-night-storm",
      "force-tokyo-night-light",
      "force-dracula",
      "force-dracula-soft",
      "force-nord",
      "force-nord-light",
      "force-github-dark",
      "force-github-dark-dimmed",
      "force-github-light",
      "force-one-dark-pro",
      "force-one-light-pro",
      "force-material-deep-ocean",
      "force-material-palenight",
      "force-material-lighter",
      "force-gruvbox-dark",
      "force-gruvbox-light",
      "force-solarized-dark",
      "force-solarized-light",
      "force-synthwave-84",
      "force-monokai-pro",
      "force-ayu-dark",
      "force-ayu-mirage",
      "force-ayu-light",
      "force-vercel-dark",
      "force-vesper",
    );

    if (theme !== "auto") {
      html.classList.add(`force-${theme}`);
    }
  };

  // Diagnostics handlers
  const handleDiagnosticsUpdate = (newDiagnostics: Diagnostic[]) => {
    setDiagnostics(newDiagnostics);
    // Don't auto-open diagnostics pane anymore
  };

  const handleDiagnosticClick = (diagnostic: Diagnostic) => {
    // Navigate to the diagnostic location
    if (codeEditorRef.current?.textarea) {
      const textarea = codeEditorRef.current.textarea;
      const lines = textarea.value.split("\n");
      let targetPosition = 0;

      for (let i = 0; i < diagnostic.line - 1 && i < lines.length; i++) {
        targetPosition += lines[i].length + 1; // +1 for newline
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

  // Debug logging
  console.log("Debug: shouldShowWelcome =", shouldShowWelcome);
  console.log("Debug: files.length =", files.length);
  console.log("Debug: isRemoteWindow =", isRemoteWindow);

  // Image Generation Modal state
  const [isImageGenerationModalOpen, setIsImageGenerationModalOpen] =
    useState(false);
  const [imageGenerationFolder, setImageGenerationFolder] =
    useState<string>("");

  // Handle image generation request
  const handleGenerateImage = (folderPath: string) => {
    setImageGenerationFolder(folderPath);
    setIsImageGenerationModalOpen(true);
  };

  // Handle image generation completion
  const handleImageGenerated = async (imagePath: string) => {
    // Refresh the directory that contains the new image
    try {
      await refreshDirectory(imageGenerationFolder);
    } catch (error) {
      console.error(
        "Error refreshing directory after image generation:",
        error,
      );
    }
  };

  // Handle creating new folder
  const handleCreateNewFolder = async () => {
    const folderName = prompt("Enter the name for the new folder:");
    if (!folderName) return;

    try {
      const newFolderPath = rootFolderPath
        ? `${rootFolderPath}/${folderName}`
        : folderName;

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
        <div className={`window-container flex flex-col h-full w-full bg-[var(--primary-bg)] overflow-hidden ${isMac() && 'rounded-xl'}`}>
          <CustomTitleBar showMinimal={true} />
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
      <div className={`window-container flex flex-col h-full w-full bg-[var(--primary-bg)] overflow-hidden ${isMac() && 'rounded-xl'}`}>
        {/* Custom Titlebar */}
        <CustomTitleBar
          projectName={
            getProjectName() !== "Explorer" ? getProjectName() : undefined
          }
          onSettingsClick={() => {
            // Create settings JSON buffer with current values
            const settingsContent = JSON.stringify(
              {
                theme: currentTheme,
                fontSize: fontSize,
                tabSize: tabSize,
                wordWrap: wordWrap,
                lineNumbers: lineNumbers,
                autoSave: autoSave,
                vimMode: vimModeEnabled,
                aiCompletion: aiCompletion,
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
            {isSidebarVisible && (
              <ResizableSidebar
                defaultWidth={220}
                minWidth={180}
                maxWidth={400}
              >
                <div className="flex flex-col h-full">
                  {/* Pane Selection Row */}
                  <div className="flex gap-1 p-2 border-b border-[var(--border-color)]">
                    <Button
                      onClick={() => {
                        setIsGitViewActive(false);
                        setIsSearchViewActive(false);
                        setIsRemoteViewActive(false);
                      }}
                      variant="ghost"
                      size="sm"
                      data-active={
                        !isGitViewActive &&
                        !isSearchViewActive &&
                        !isRemoteViewActive
                      }
                      className={`text-xs flex items-center justify-center w-8 h-8 rounded ${!isGitViewActive &&
                        !isSearchViewActive &&
                        !isRemoteViewActive
                        ? "bg-[var(--hover-color)] text-[var(--text-color)]"
                        : "hover:bg-[var(--hover-color)]"
                        }`}
                      title="File Explorer"
                    >
                      <Folder size={14} />
                    </Button>
                    {coreFeatures.search && (
                      <Button
                        onClick={() => {
                          setIsSearchViewActive(true);
                          setIsGitViewActive(false);
                          setIsRemoteViewActive(false);
                        }}
                        variant="ghost"
                        size="sm"
                        data-active={isSearchViewActive}
                        className={`text-xs flex items-center justify-center w-8 h-8 rounded ${isSearchViewActive
                          ? "bg-[var(--hover-color)] text-[var(--text-color)]"
                          : "hover:bg-[var(--hover-color)]"
                          }`}
                        title="Search"
                      >
                        <Search size={14} />
                      </Button>
                    )}
                    {coreFeatures.git && (
                      <Button
                        onClick={() => {
                          setIsGitViewActive(true);
                          setIsSearchViewActive(false);
                          setIsRemoteViewActive(false);
                        }}
                        variant="ghost"
                        size="sm"
                        data-active={isGitViewActive}
                        className={`text-xs flex items-center justify-center w-8 h-8 rounded ${isGitViewActive
                          ? "bg-[var(--hover-color)] text-[var(--text-color)]"
                          : "hover:bg-[var(--hover-color)]"
                          }`}
                        title="Git Source Control"
                      >
                        <GitBranch size={14} />
                      </Button>
                    )}
                    {coreFeatures.remote && (
                      <Button
                        onClick={() => {
                          setIsRemoteViewActive(true);
                          setIsGitViewActive(false);
                          setIsSearchViewActive(false);
                        }}
                        variant="ghost"
                        size="sm"
                        data-active={isRemoteViewActive}
                        className={`text-xs flex items-center justify-center w-8 h-8 rounded ${isRemoteViewActive
                          ? "bg-[var(--hover-color)] text-[var(--text-color)]"
                          : "hover:bg-[var(--hover-color)]"
                          }`}
                        title="Remote Connections"
                      >
                        <Server size={14} />
                      </Button>
                    )}
                    <Button
                      onClick={handleOpenExtensions}
                      variant="ghost"
                      size="sm"
                      className="text-xs flex items-center justify-center w-8 h-8 rounded hover:bg-[var(--hover-color)]"
                      title="Extensions"
                    >
                      <Package size={14} />
                    </Button>
                  </div>

                  {/* Remote Window Header */}
                  {isRemoteWindow && remoteConnectionName && (
                    <div className="flex items-center px-3 py-1.5 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
                      <Server
                        size={12}
                        className="text-[var(--text-lighter)] mr-2"
                      />
                      <span
                        className="text-xs font-medium text-[var(--text-color)] cursor-pointer hover:bg-[var(--hover-color)] px-2 py-1 rounded flex-1"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setProjectNameMenu({
                            x: e.currentTarget.getBoundingClientRect().left,
                            y: e.currentTarget.getBoundingClientRect().bottom + 5,
                          });
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setProjectNameMenu({
                            x: e.currentTarget.getBoundingClientRect().left,
                            y: e.currentTarget.getBoundingClientRect().bottom + 5,
                          });
                        }}
                        title="Click for workspace options"
                      >
                        {remoteConnectionName}
                      </span>
                    </div>
                  )}

                  {/* Pane Title and Action Buttons Row - Only show for file tree view */}
                  {!isGitViewActive &&
                    !isSearchViewActive &&
                    !isRemoteViewActive &&
                    !isRemoteWindow && (
                      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
                        <h3
                          className="font-mono text-xs font-medium text-[var(--text-color)] tracking-wide cursor-pointer hover:bg-[var(--hover-color)] px-2 py-1 rounded"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setProjectNameMenu({
                              x: e.currentTarget.getBoundingClientRect().left,
                              y: e.currentTarget.getBoundingClientRect().bottom + 5,
                            });
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setProjectNameMenu({
                              x: e.currentTarget.getBoundingClientRect().left,
                              y: e.currentTarget.getBoundingClientRect().bottom + 5,
                            });
                          }}
                          title="Click for workspace options"
                        >
                          {getProjectName()}
                        </h3>
                        <div className="flex items-center gap-1">
                          <Button
                            onClick={handleOpenFolder}
                            variant="ghost"
                            size="sm"
                            className="text-xs flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--hover-color)]"
                            title="Open Folder"
                          >
                            <FolderOpen size={12} />
                          </Button>
                          <Button
                            onClick={handleCreateNewFile}
                            variant="ghost"
                            size="sm"
                            className="text-xs flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--hover-color)]"
                            title="New File"
                          >
                            <FilePlus size={12} />
                          </Button>
                        </div>
                      </div>
                    )}

                  {/* Main Content Area */}
                  <div className="flex-1 overflow-auto">
                    {isGitViewActive && coreFeatures.git ? (
                      <GitView
                        repoPath={rootFolderPath}
                        onFileSelect={handleFileSelect}
                      />
                    ) : isSearchViewActive && coreFeatures.search ? (
                      <SearchView
                        ref={searchViewRef}
                        rootFolderPath={rootFolderPath}
                        allProjectFiles={allProjectFiles}
                        onFileSelect={(path, line, column) =>
                          handleFileSelect(path, false, line, column)
                        }
                      />
                    ) : isRemoteViewActive && coreFeatures.remote ? (
                      <RemoteConnectionView onFileSelect={handleFileSelect} />
                    ) : (
                      <FileTree
                        files={files}
                        activeBufferPath={activeBuffer?.path}
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
                        onCreateNewFileInDirectory={
                          handleCreateNewFileInDirectory
                        }
                        onGenerateImage={handleGenerateImage}
                      />
                    )}
                  </div>
                </div>
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
                    onServerInstall={(server) => {
                      console.log("Installing server:", server.name);
                      // Here you would integrate with the LSP system
                    }}
                    onServerUninstall={(serverId) => {
                      console.log("Uninstalling server:", serverId);
                      // Here you would clean up the LSP system
                    }}
                    onThemeChange={handleThemeChange}
                    currentTheme={currentTheme}
                    coreFeatures={coreFeaturesList}
                    onCoreFeatureToggle={handleCoreFeatureToggle}
                  />
                ) : (
                  <CodeEditor
                    value={activeBuffer.content}
                    onChange={(content) =>
                      vimMode === "insert" || !vimEnabled
                        ? handleContentChange(content)
                        : undefined
                    }
                    onKeyDown={handleVimKeyDown}
                    onCursorPositionChange={(position) => {
                      if (vimEnabled) {
                        setCursorPosition(position);
                      }
                    }}
                    placeholder="Select a file to edit..."
                    disabled={!activeBuffer}
                    className={
                      vimEnabled && vimMode === "visual"
                        ? "vim-visual-selection"
                        : ""
                    }
                    filename={getFilenameFromPath(activeBuffer.path)}
                    vimEnabled={vimEnabled}
                    vimMode={vimMode}
                    cursorPosition={cursorPosition}
                    searchQuery={searchState.query}
                    searchMatches={searchState.matches}
                    currentMatchIndex={searchState.currentMatch - 1}
                    filePath={activeBuffer.path}
                    fontSize={fontSize}
                    tabSize={tabSize}
                    wordWrap={wordWrap}
                    lineNumbers={lineNumbers}
                    ref={codeEditorRef}
                    aiCompletion={aiCompletion}
                    minimap={isMinimapVisible}
                    getCompletions={getCompletions}
                    getHover={getHover}
                    isLanguageSupported={isLanguageSupported}
                    openDocument={openDocument}
                    changeDocument={changeDocument}
                    closeDocument={closeDocument}
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
                      <span>
                        {activeBuffer.content.split("\n").length} lines
                      </span>
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
                        setBottomPaneActiveTab("terminal");
                        setIsBottomPaneVisible(
                          !isBottomPaneVisible ||
                          bottomPaneActiveTab !== "terminal",
                        );
                      }}
                      className={`flex items-center gap-1 px-2 py-1 border rounded transition-colors ${isBottomPaneVisible && bottomPaneActiveTab === "terminal"
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
                        setBottomPaneActiveTab("diagnostics");
                        setIsBottomPaneVisible(
                          !isBottomPaneVisible ||
                          bottomPaneActiveTab !== "diagnostics",
                        );
                      }}
                      className={`flex items-center gap-1 px-2 py-1 border rounded transition-colors ${isBottomPaneVisible &&
                        bottomPaneActiveTab === "diagnostics"
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
                      onClick={() => setIsGitHubCopilotSettingsVisible(true)}
                      className="flex items-center gap-1 px-2 py-1 bg-[var(--primary-bg)] border border-[var(--border-color)] rounded hover:bg-[var(--hover-color)] transition-colors"
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
                isVisible={isRightPaneVisible}
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
            isVisible={isBottomPaneVisible}
            onClose={() => setIsBottomPaneVisible(false)}
            activeTab={bottomPaneActiveTab}
            onTabChange={(tab) => setBottomPaneActiveTab(tab)}
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
            isVisible={isCommandBarVisible}
            onClose={handleCommandBarClose}
            files={allProjectFiles}
            onFileSelect={handleCommandBarFileSelect}
            rootFolderPath={rootFolderPath}
          />

          {/* Command Palette */}
          <CommandPalette
            ref={commandPaletteRef}
            isVisible={isCommandPaletteVisible}
            onClose={handleCommandPaletteClose}
            onOpenSettings={() => {
              // Create settings JSON buffer with current values
              const settingsContent = JSON.stringify(
                {
                  theme: currentTheme,
                  fontSize: fontSize,
                  tabSize: tabSize,
                  wordWrap: wordWrap,
                  lineNumbers: lineNumbers,
                  autoSave: autoSave,
                  vimMode: vimModeEnabled,
                  aiCompletion: aiCompletion,
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
            isVisible={isGitHubCopilotSettingsVisible}
            onClose={() => setIsGitHubCopilotSettingsVisible(false)}
          />

          {/* Quick Edit Inline */}
          <QuickEditInline
            isOpen={isQuickEditVisible}
            onClose={handleQuickEditClose}
            onApplyEdit={handleQuickEditApply}
            selectedText={quickEditSelection.text}
            cursorPosition={quickEditSelection.cursorPosition}
            filename={
              activeBuffer ? getFilenameFromPath(activeBuffer.path) : undefined
            }
            language={
              activeBuffer
                ? getLanguageFromFilename(
                  getFilenameFromPath(activeBuffer.path),
                )
                : undefined
            }
          />



          {/* Project Name Menu (Unified) */}
          {projectNameMenu && (
            <div
              className="fixed bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-md shadow-lg z-50 py-1 min-w-[200px]"
              style={{
                left: projectNameMenu.x,
                top: projectNameMenu.y,
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
            >
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleOpenFolder();
                  setProjectNameMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
              >
                <FilePlus size={12} />
                Add Folder to Workspace
              </button>

              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCollapseAllFoldersComplete();
                  setProjectNameMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
              >
                <Folder size={12} />
                Collapse All Folders
              </button>

              {recentFolders.length > 0 && (
                <>
                  <div className="border-t border-[var(--border-color)] my-1"></div>
                  <div className="px-3 py-1 text-xs font-mono text-[var(--text-lighter)] uppercase tracking-wide">
                    Recent Folders
                  </div>
                  {recentFolders.slice(0, 5).map((folder, index) => (
                    <button
                      key={folder.path}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleOpenRecentFolder(folder.path);
                        setProjectNameMenu(null);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs font-mono text-[var(--text-color)] hover:bg-[var(--hover-color)] flex items-center gap-2"
                    >
                      <Folder size={12} />
                      <div className="flex flex-col items-start min-w-0 flex-1">
                        <span className="truncate font-medium">{folder.name}</span>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Image Generation Modal */}
          <ImageGenerationModal
            isOpen={isImageGenerationModalOpen}
            onClose={() => setIsImageGenerationModalOpen(false)}
            targetFolder={imageGenerationFolder}
            onImageGenerated={handleImageGenerated}
          />


        </div>
      </div>
    </div>
  );
}

export default App;
