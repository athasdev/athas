import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import {
  ArrowUp,
  GitBranch,
  GitCommit,
  Palette,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
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
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, filteredActions, selectedIndex, onClose]);

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
    <Command isVisible={isVisible}>
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
