import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowUp,
  ChevronRight,
  Cloud,
  Code2,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommit,
  Hash,
  Info,
  Languages,
  Lightbulb,
  MessageSquare,
  MousePointer2,
  Package,
  Palette,
  PanelBottom,
  PanelLeft,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Terminal,
  WrapText,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/contexts/toast-context";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { useSettingsStore } from "@/settings/store";
import { useAppStore } from "@/stores/app-store";
import { useLspStore } from "@/stores/lsp-store";
import { useUIState } from "@/stores/ui-state-store";
import { vimCommands } from "@/stores/vim-commands";
import { useVimStore } from "@/stores/vim-store";
import {
  commitChanges,
  discardAllChanges,
  fetchChanges,
  pullChanges,
  pushChanges,
  stageAllFiles,
  unstageAllFiles,
} from "@/version-control/git/controllers/git";
import { useGitStore } from "@/version-control/git/controllers/git-store";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command";
import KeybindingBadge from "../../ui/keybinding-badge";

interface Action {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: string;
  keybinding?: string[];
  action: () => void;
}

const CommandPalette = () => {
  // Get data from stores
  const {
    isCommandPaletteVisible,
    setIsCommandPaletteVisible,
    setIsSettingsDialogVisible,
    setIsThemeSelectorVisible,
    setIsIconThemeSelectorVisible,
    isSidebarVisible,
    setIsSidebarVisible,
    isBottomPaneVisible,
    setIsBottomPaneVisible,
    bottomPaneActiveTab,
    setBottomPaneActiveTab,
    isFindVisible,
    setIsFindVisible,
    setActiveView,
    setIsCommandBarVisible,
  } = useUIState();
  const { openQuickEdit } = useAppStore.use.actions();

  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();

  const isVisible = isCommandPaletteVisible;
  const onClose = () => setIsCommandPaletteVisible(false);
  const onQuickEditInline = () => {
    // TODO: Implement quick edit
    const selection = window.getSelection();
    if (selection?.toString()) {
      openQuickEdit({
        text: selection.toString(),
        cursorPosition: { x: 0, y: 0 },
        selectionRange: { start: 0, end: selection.toString().length },
      });
    }
  };
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { settings } = useSettingsStore();
  const vimMode = settings.vimMode;
  const { setMode } = useVimStore.use.actions();
  const lspStatus = useLspStore.use.lspStatus();
  const { clearLspError, updateLspStatus } = useLspStore.use.actions();
  const { rootFolderPath } = useFileSystemStore();
  const gitStore = useGitStore();
  const { showToast } = useToast();

  // Focus is handled internally when the palette becomes visible

  // Define available actions
  const actions: Action[] = [
    {
      id: "ai-quick-edit",
      label: "AI: Quick Edit Selection",
      description: "Edit selected text using AI inline",
      icon: <Sparkles size={14} />,
      category: "AI",
      keybinding: ["⌘", "E"],
      action: () => {
        if (onQuickEditInline) onQuickEditInline();
        onClose();
      },
    },
    {
      id: "open-settings",
      label: "Preferences: Open Settings",
      description: "Open settings dialog",
      icon: <Settings size={14} />,
      category: "Settings",
      keybinding: ["⌘", ","],
      action: () => {
        onClose();
        setIsSettingsDialogVisible(true);
      },
    },
    {
      id: "open-settings-json",
      label: "Preferences: Open Settings JSON file",
      description: "Open settings JSON file",
      icon: <Settings size={14} />,
      category: "Settings",
      action: () => {
        onClose();
        appDataDir().then((path) => {
          handleFileSelect(`${path}/settings.json`, false);
        });
      },
    },
    {
      id: "color-theme",
      label: "Preferences: Color Theme",
      description: "Choose a color theme",
      icon: <Palette size={14} />,
      category: "Theme",
      keybinding: ["⌘", "T"],
      action: () => {
        onClose();
        setIsThemeSelectorVisible(true);
      },
    },
    {
      id: "icon-theme",
      label: "Preferences: Icon Theme",
      description: "Choose an icon theme",
      icon: <Palette size={14} />,
      category: "Theme",
      action: () => {
        onClose();
        setIsIconThemeSelectorVisible(true);
      },
    },
    {
      id: "toggle-vim-mode",
      label: vimMode ? "Vim: Disable Vim Mode" : "Vim: Enable Vim Mode",
      description: vimMode ? "Switch to normal editing mode" : "Enable Vim keybindings",
      icon: <Terminal size={14} />,
      category: "Vim",
      action: () => {
        useSettingsStore.getState().updateSetting("vimMode", !vimMode);
        onClose();
      },
    },
    {
      id: "toggle-sidebar",
      label: isSidebarVisible ? "View: Hide Sidebar" : "View: Show Sidebar",
      description: isSidebarVisible ? "Hide the sidebar panel" : "Show the sidebar panel",
      icon: <PanelLeft size={14} />,
      category: "View",
      keybinding: ["⌘", "B"],
      action: () => {
        setIsSidebarVisible(!isSidebarVisible);
        onClose();
      },
    },
    {
      id: "toggle-bottom-pane",
      label: isBottomPaneVisible ? "View: Hide Bottom Pane" : "View: Show Bottom Pane",
      description: isBottomPaneVisible ? "Hide the bottom pane" : "Show the bottom pane",
      icon: <PanelBottom size={14} />,
      category: "View",
      action: () => {
        setIsBottomPaneVisible(!isBottomPaneVisible);
        onClose();
      },
    },
    {
      id: "toggle-terminal",
      label:
        isBottomPaneVisible && bottomPaneActiveTab === "terminal"
          ? "View: Hide Terminal"
          : "View: Show Terminal",
      description: "Toggle integrated terminal panel",
      icon: <Terminal size={14} />,
      category: "View",
      keybinding: ["⌘", "`"],
      action: () => {
        if (isBottomPaneVisible && bottomPaneActiveTab === "terminal") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("terminal");
          setIsBottomPaneVisible(true);
        }
        onClose();
      },
    },
    {
      id: "toggle-diagnostics-panel",
      label:
        isBottomPaneVisible && bottomPaneActiveTab === "diagnostics"
          ? "View: Hide Diagnostics"
          : "View: Show Diagnostics",
      description: "Toggle diagnostics panel",
      icon: <AlertCircle size={14} />,
      category: "View",
      keybinding: ["⌘", "⇧", "J"],
      action: () => {
        if (isBottomPaneVisible && bottomPaneActiveTab === "diagnostics") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("diagnostics");
          setIsBottomPaneVisible(true);
        }
        onClose();
      },
    },
    {
      id: "toggle-ai-chat-view",
      label: settings.isAIChatVisible ? "View: Hide AI Chat" : "View: Show AI Chat",
      description: settings.isAIChatVisible ? "Hide AI chat panel" : "Show AI chat panel",
      icon: <MessageSquare size={14} />,
      category: "View",
      keybinding: ["⌘", "R"],
      action: () => {
        useSettingsStore.getState().updateSetting("isAIChatVisible", !settings.isAIChatVisible);
        onClose();
      },
    },
    {
      id: "toggle-find-view",
      label: isFindVisible ? "View: Hide Find" : "View: Show Find",
      description: isFindVisible ? "Hide find in file" : "Show find in file",
      icon: <Search size={14} />,
      category: "View",
      keybinding: ["⌘", "F"],
      action: () => {
        setIsFindVisible(!isFindVisible);
        onClose();
      },
    },
    {
      id: "toggle-sidebar-position",
      label: "View: Switch Sidebar Position",
      description:
        settings.sidebarPosition === "left"
          ? "Move sidebar to right side"
          : "Move sidebar to left side",
      icon: <ArrowLeftRight size={14} />,
      category: "View",
      keybinding: ["⌘", "⇧", "B"],
      action: () => {
        useSettingsStore
          .getState()
          .updateSetting("sidebarPosition", settings.sidebarPosition === "left" ? "right" : "left");
        onClose();
      },
    },
    {
      id: "view-show-files",
      label: "View: Show Files",
      description: "Switch to files explorer view",
      icon: <FolderOpen size={14} />,
      category: "Navigation",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("files");
        onClose();
      },
    },
    {
      id: "view-show-git",
      label: "View: Show Git",
      description: "Switch to Git view",
      icon: <GitBranch size={14} />,
      category: "Navigation",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("git");
        onClose();
      },
    },
    {
      id: "view-show-search",
      label: "View: Show Search",
      description: "Switch to project search view",
      icon: <Search size={14} />,
      category: "Navigation",
      keybinding: ["⌘", "⇧", "F"],
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("search");
        onClose();
      },
    },
    {
      id: "view-show-remote",
      label: "View: Show Remote",
      description: "Switch to remote development view",
      icon: <Cloud size={14} />,
      category: "Navigation",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("remote");
        onClose();
      },
    },
    {
      id: "view-show-extensions",
      label: "View: Show Extensions",
      description: "Switch to extensions view",
      icon: <Package size={14} />,
      category: "Navigation",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("extensions");
        onClose();
      },
    },
    {
      id: "go-to-line",
      label: "Go: Go to Line",
      description: "Jump to a specific line number",
      icon: <Hash size={14} />,
      category: "Navigation",
      keybinding: ["⌘", "G"],
      action: () => {
        onClose();
        window.dispatchEvent(new CustomEvent("menu-go-to-line"));
      },
    },
    {
      id: "go-to-file",
      label: "Go: Go to File",
      description: "Open file picker",
      icon: <FileText size={14} />,
      category: "Navigation",
      keybinding: ["⌘", "P"],
      action: () => {
        onClose();
        setIsCommandBarVisible(true);
      },
    },
    {
      id: "toggle-word-wrap",
      label: settings.wordWrap ? "Editor: Disable Word Wrap" : "Editor: Enable Word Wrap",
      description: settings.wordWrap
        ? "Disable line wrapping in editor"
        : "Wrap lines that exceed viewport width",
      icon: <WrapText size={14} />,
      category: "Editor",
      action: () => {
        useSettingsStore.getState().updateSetting("wordWrap", !settings.wordWrap);
        onClose();
      },
    },
    {
      id: "toggle-line-numbers",
      label: settings.lineNumbers ? "Editor: Hide Line Numbers" : "Editor: Show Line Numbers",
      description: settings.lineNumbers
        ? "Hide line numbers in editor"
        : "Show line numbers in editor",
      icon: <Hash size={14} />,
      category: "Editor",
      action: () => {
        useSettingsStore.getState().updateSetting("lineNumbers", !settings.lineNumbers);
        onClose();
      },
    },
    {
      id: "toggle-relative-line-numbers",
      label: settings.vimRelativeLineNumbers
        ? "Editor: Disable Relative Line Numbers"
        : "Editor: Enable Relative Line Numbers",
      description: settings.vimRelativeLineNumbers
        ? "Use absolute line numbers"
        : "Show relative line numbers (Vim mode)",
      icon: <Hash size={14} />,
      category: "Editor",
      action: () => {
        useSettingsStore
          .getState()
          .updateSetting("vimRelativeLineNumbers", !settings.vimRelativeLineNumbers);
        onClose();
      },
    },
    {
      id: "toggle-auto-save",
      label: settings.autoSave ? "General: Disable Auto Save" : "General: Enable Auto Save",
      description: settings.autoSave
        ? "Disable automatic file saving"
        : "Automatically save files when editing",
      icon: <Save size={14} />,
      category: "Settings",
      action: () => {
        useSettingsStore.getState().updateSetting("autoSave", !settings.autoSave);
        onClose();
      },
    },
    {
      id: "toggle-mouse-wheel-zoom",
      label: settings.mouseWheelZoom
        ? "General: Disable Mouse Wheel Zoom"
        : "General: Enable Mouse Wheel Zoom",
      description: settings.mouseWheelZoom
        ? "Disable zoom with mouse wheel"
        : "Use mouse wheel to zoom in/out",
      icon: <MousePointer2 size={14} />,
      category: "Settings",
      action: () => {
        useSettingsStore.getState().updateSetting("mouseWheelZoom", !settings.mouseWheelZoom);
        onClose();
      },
    },
    {
      id: "toggle-auto-detect-language",
      label: settings.autoDetectLanguage
        ? "Language: Disable Auto-detect Language"
        : "Language: Enable Auto-detect Language",
      description: settings.autoDetectLanguage
        ? "Manually set language for files"
        : "Automatically detect file language from extension",
      icon: <Languages size={14} />,
      category: "Language",
      action: () => {
        useSettingsStore
          .getState()
          .updateSetting("autoDetectLanguage", !settings.autoDetectLanguage);
        onClose();
      },
    },
    {
      id: "toggle-format-on-save",
      label: settings.formatOnSave
        ? "Language: Disable Format on Save"
        : "Language: Enable Format on Save",
      description: settings.formatOnSave
        ? "Disable automatic formatting on save"
        : "Automatically format code when saving",
      icon: <Code2 size={14} />,
      category: "Language",
      action: () => {
        useSettingsStore.getState().updateSetting("formatOnSave", !settings.formatOnSave);
        onClose();
      },
    },
    {
      id: "toggle-auto-completion",
      label: settings.autoCompletion
        ? "Language: Disable Auto Completion"
        : "Language: Enable Auto Completion",
      description: settings.autoCompletion
        ? "Disable completion suggestions"
        : "Show completion suggestions while typing",
      icon: <Lightbulb size={14} />,
      category: "Language",
      action: () => {
        useSettingsStore.getState().updateSetting("autoCompletion", !settings.autoCompletion);
        onClose();
      },
    },
    {
      id: "toggle-parameter-hints",
      label: settings.parameterHints
        ? "Language: Disable Parameter Hints"
        : "Language: Enable Parameter Hints",
      description: settings.parameterHints
        ? "Disable function parameter hints"
        : "Show function parameter hints",
      icon: <Info size={14} />,
      category: "Language",
      action: () => {
        useSettingsStore.getState().updateSetting("parameterHints", !settings.parameterHints);
        onClose();
      },
    },
    {
      id: "toggle-ai-completion",
      label: settings.aiCompletion ? "AI: Disable AI Completion" : "AI: Enable AI Completion",
      description: settings.aiCompletion
        ? "Disable AI-powered code completion"
        : "Enable AI-powered code completion",
      icon: <Sparkles size={14} />,
      category: "AI",
      action: () => {
        useSettingsStore.getState().updateSetting("aiCompletion", !settings.aiCompletion);
        onClose();
      },
    },
    {
      id: "toggle-breadcrumbs",
      label: settings.coreFeatures.breadcrumbs
        ? "Features: Disable Breadcrumbs"
        : "Features: Enable Breadcrumbs",
      description: settings.coreFeatures.breadcrumbs
        ? "Hide breadcrumbs navigation"
        : "Show breadcrumbs navigation",
      icon: <ChevronRight size={14} />,
      category: "Features",
      action: () => {
        useSettingsStore.getState().updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          breadcrumbs: !settings.coreFeatures.breadcrumbs,
        });
        onClose();
      },
    },
    {
      id: "toggle-diagnostics",
      label: settings.coreFeatures.diagnostics
        ? "Features: Disable Diagnostics"
        : "Features: Enable Diagnostics",
      description: settings.coreFeatures.diagnostics
        ? "Hide diagnostics panel"
        : "Show diagnostics panel",
      icon: <AlertCircle size={14} />,
      category: "Features",
      action: () => {
        useSettingsStore.getState().updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          diagnostics: !settings.coreFeatures.diagnostics,
        });
        onClose();
      },
    },
    {
      id: "toggle-search-feature",
      label: settings.coreFeatures.search ? "Features: Disable Search" : "Features: Enable Search",
      description: settings.coreFeatures.search
        ? "Disable search functionality"
        : "Enable search functionality",
      icon: <Search size={14} />,
      category: "Features",
      action: () => {
        useSettingsStore.getState().updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          search: !settings.coreFeatures.search,
        });
        onClose();
      },
    },
    {
      id: "toggle-git-feature",
      label: settings.coreFeatures.git ? "Features: Disable Git" : "Features: Enable Git",
      description: settings.coreFeatures.git ? "Disable Git integration" : "Enable Git integration",
      icon: <GitBranch size={14} />,
      category: "Features",
      action: () => {
        useSettingsStore.getState().updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          git: !settings.coreFeatures.git,
        });
        onClose();
      },
    },
    {
      id: "toggle-terminal-feature",
      label: settings.coreFeatures.terminal
        ? "Features: Disable Terminal"
        : "Features: Enable Terminal",
      description: settings.coreFeatures.terminal
        ? "Disable integrated terminal"
        : "Enable integrated terminal",
      icon: <Terminal size={14} />,
      category: "Features",
      action: () => {
        useSettingsStore.getState().updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          terminal: !settings.coreFeatures.terminal,
        });
        onClose();
      },
    },
    {
      id: "toggle-ai-chat-feature",
      label: settings.coreFeatures.aiChat
        ? "Features: Disable AI Chat"
        : "Features: Enable AI Chat",
      description: settings.coreFeatures.aiChat ? "Disable AI chat panel" : "Enable AI chat panel",
      icon: <MessageSquare size={14} />,
      category: "Features",
      action: () => {
        useSettingsStore.getState().updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          aiChat: !settings.coreFeatures.aiChat,
        });
        onClose();
      },
    },
    {
      id: "toggle-remote-feature",
      label: settings.coreFeatures.remote ? "Features: Disable Remote" : "Features: Enable Remote",
      description: settings.coreFeatures.remote
        ? "Disable remote development"
        : "Enable remote development",
      icon: <Cloud size={14} />,
      category: "Features",
      action: () => {
        useSettingsStore.getState().updateSetting("coreFeatures", {
          ...settings.coreFeatures,
          remote: !settings.coreFeatures.remote,
        });
        onClose();
      },
    },
    {
      id: "lsp-status",
      label: "LSP: Show Status",
      description: `Status: ${lspStatus.status} (${lspStatus.activeWorkspaces.length} workspaces)`,
      icon: <Terminal size={14} />,
      category: "LSP",
      action: () => {
        alert(
          `LSP Status: ${lspStatus.status}\nActive workspaces: ${lspStatus.activeWorkspaces.join(", ") || "None"}\nError: ${lspStatus.lastError || "None"}`,
        );
        onClose();
      },
    },
    {
      id: "lsp-restart",
      label: "LSP: Restart Server",
      description: "Restart the LSP server",
      icon: <RefreshCw size={14} />,
      category: "LSP",
      action: () => {
        updateLspStatus("connecting");
        clearLspError();
        setTimeout(() => {
          updateLspStatus("connected", [rootFolderPath || ""]);
        }, 1000);
        onClose();
      },
    },
    {
      id: "git-stage-all",
      label: "Git: Stage All Changes",
      description: "Stage all modified files",
      icon: <GitBranch size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const success = await stageAllFiles(rootFolderPath);
          if (success) {
            showToast({ message: "All files staged successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to stage files", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-unstage-all",
      label: "Git: Unstage All Changes",
      description: "Unstage all staged files",
      icon: <GitBranch size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const success = await unstageAllFiles(rootFolderPath);
          if (success) {
            showToast({ message: "All files unstaged successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to unstage files", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-commit",
      label: "Git: Commit Changes",
      description: "Commit staged changes",
      icon: <GitCommit size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        const message = prompt("Enter commit message:");
        if (!message) {
          onClose();
          return;
        }
        try {
          const success = await commitChanges(rootFolderPath, message);
          if (success) {
            showToast({ message: "Changes committed successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to commit changes", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-push",
      label: "Git: Push",
      description: "Push changes to remote",
      icon: <ArrowUp size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          showToast({ message: "Pushing changes...", type: "info" });
          const success = await pushChanges(rootFolderPath);
          if (success) {
            showToast({ message: "Changes pushed successfully", type: "success" });
          } else {
            showToast({ message: "Failed to push changes", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-pull",
      label: "Git: Pull",
      description: "Pull changes from remote",
      icon: <RefreshCw size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          showToast({ message: "Pulling changes...", type: "info" });
          const success = await pullChanges(rootFolderPath);
          if (success) {
            showToast({ message: "Changes pulled successfully", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to pull changes", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-fetch",
      label: "Git: Fetch",
      description: "Fetch changes from remote",
      icon: <RefreshCw size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        try {
          const success = await fetchChanges(rootFolderPath);
          if (success) {
            showToast({ message: "Fetched successfully", type: "success" });
          } else {
            showToast({ message: "Failed to fetch", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-discard-all",
      label: "Git: Discard All Changes",
      description: "Discard all uncommitted changes",
      icon: <GitBranch size={14} />,
      category: "Git",
      action: async () => {
        if (!rootFolderPath) {
          showToast({ message: "No repository open", type: "error" });
          onClose();
          return;
        }
        if (!confirm("Are you sure you want to discard all changes? This cannot be undone.")) {
          onClose();
          return;
        }
        try {
          const success = await discardAllChanges(rootFolderPath);
          if (success) {
            showToast({ message: "All changes discarded", type: "success" });
            window.dispatchEvent(new Event("refresh-git-data"));
          } else {
            showToast({ message: "Failed to discard changes", type: "error" });
          }
        } catch (error) {
          showToast({ message: `Error: ${error}`, type: "error" });
        }
        onClose();
      },
    },
    {
      id: "git-refresh",
      label: "Git: Refresh Status",
      description: "Refresh Git status",
      icon: <RefreshCw size={14} />,
      category: "Git",
      action: () => {
        gitStore.actions.setIsRefreshing(true);
        window.dispatchEvent(new Event("refresh-git-data"));
        showToast({ message: "Refreshing Git status...", type: "info" });
        setTimeout(() => {
          gitStore.actions.setIsRefreshing(false);
          showToast({ message: "Git status refreshed", type: "success" });
        }, 1000);
        onClose();
      },
    },
    {
      id: "cli-install",
      label: "CLI: Install Terminal Command",
      description: "Install 'athas' command for terminal",
      icon: <Terminal size={14} />,
      category: "CLI",
      action: async () => {
        try {
          showToast({ message: "Installing CLI command...", type: "info" });
          const result = await invoke<string>("install_cli_command");
          showToast({ message: result, type: "success" });
        } catch (error) {
          showToast({
            message: `Failed to install CLI: ${error}. You may need administrator privileges.`,
            type: "error",
          });
        }
        onClose();
      },
    },
  ];

  // Add vim commands if vim mode is enabled
  const vimActions: Action[] = vimMode
    ? vimCommands.map((cmd) => ({
        id: `vim-${cmd.name}`,
        label: `Vim: ${cmd.name}`,
        description: cmd.description,
        category: "Vim",
        action: () => {
          cmd.execute();
          onClose();
        },
      }))
    : [];

  // Add mode-switching commands if vim mode is enabled
  const vimModeActions: Action[] = vimMode
    ? [
        {
          id: "vim-normal-mode",
          label: "Vim: Enter Normal Mode",
          description: "Switch to normal mode",
          category: "Vim",
          action: () => {
            setMode("normal");
            onClose();
          },
        },
        {
          id: "vim-insert-mode",
          label: "Vim: Enter Insert Mode",
          description: "Switch to insert mode",
          category: "Vim",
          action: () => {
            setMode("insert");
            onClose();
          },
        },
        {
          id: "vim-visual-mode",
          label: "Vim: Enter Visual Mode",
          description: "Switch to visual mode (character)",
          category: "Vim",
          action: () => {
            setMode("visual");
            onClose();
          },
        },
      ]
    : [];

  // Combine all actions
  const allActions = [...actions, ...vimActions, ...vimModeActions];

  // Filter actions based on query
  const filteredActions = allActions.filter(
    (action) =>
      action.label.toLowerCase().includes(query.toLowerCase()) ||
      action.description?.toLowerCase().includes(query.toLowerCase()) ||
      action.category.toLowerCase().includes(query.toLowerCase()),
  );

  // Handle keyboard navigation
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < filteredActions.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredActions[selectedIndex]) {
            filteredActions[selectedIndex].action();
          }
          break;
        // Escape is now handled globally in use-keyboard-shortcuts
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, filteredActions, selectedIndex]);

  // Reset state when visibility changes
  useEffect(() => {
    if (isVisible) {
      setQuery("");
      setSelectedIndex(0);
      // Don't reset dialog states - they should persist when command palette closes
      // Immediate focus without delay for better UX
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      });
    }
  }, [isVisible]);

  // Update selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current && filteredActions.length > 0) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex, filteredActions.length]);

  if (!isVisible) return null;

  return (
    <Command isVisible={isVisible} onClose={onClose}>
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder="Type a command..."
        />
      </CommandHeader>

      <CommandList ref={resultsRef}>
        {filteredActions.length === 0 ? (
          <CommandEmpty>No commands found</CommandEmpty>
        ) : (
          filteredActions.map((action, index) => (
            <CommandItem
              key={action.id}
              onClick={() => {
                action.action();
              }}
              isSelected={index === selectedIndex}
              className="px-3 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{action.label}</div>
              </div>
              {action.keybinding && (
                <div className="flex-shrink-0">
                  <KeybindingBadge keys={action.keybinding} />
                </div>
              )}
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
};

CommandPalette.displayName = "CommandPalette";

export default CommandPalette;
