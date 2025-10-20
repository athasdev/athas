import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Sparkles, Terminal } from "lucide-react";
import type { Action } from "../models/action.types";

interface AdvancedActionsParams {
  lspStatus: {
    status: string;
    activeWorkspaces: string[];
    lastError?: string | null | undefined;
  };
  updateLspStatus: (status: string, workspaces?: string[], error?: string) => void;
  clearLspError: () => void;
  rootFolderPath: string | null | undefined;
  vimMode: boolean;
  vimCommands: Array<{ name: string; description: string; execute: () => void }>;
  setMode: (mode: "normal" | "insert" | "visual") => void;
  openQuickEdit: (params: {
    text: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  }) => void;
  showToast: (params: { message: string; type: "success" | "error" | "info" }) => void;
  onClose: () => void;
}

export const createAdvancedActions = (params: AdvancedActionsParams): Action[] => {
  const {
    lspStatus,
    updateLspStatus,
    clearLspError,
    rootFolderPath,
    vimMode,
    vimCommands,
    setMode,
    openQuickEdit,
    showToast,
    onClose,
  } = params;

  const baseActions: Action[] = [
    {
      id: "ai-quick-edit",
      label: "AI: Quick Edit Selection",
      description: "Edit selected text using AI inline",
      icon: <Sparkles size={14} />,
      category: "AI",
      keybinding: ["⌘", "E"],
      action: () => {
        const selection = window.getSelection();
        if (selection?.toString()) {
          openQuickEdit({
            text: selection.toString(),
            cursorPosition: { x: 0, y: 0 },
            selectionRange: { start: 0, end: selection.toString().length },
          });
        }
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
        icon: undefined,
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
          icon: undefined,
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
          icon: undefined,
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
          icon: undefined,
          category: "Vim",
          action: () => {
            setMode("visual");
            onClose();
          },
        },
      ]
    : [];

  return [...baseActions, ...vimActions, ...vimModeActions];
};
