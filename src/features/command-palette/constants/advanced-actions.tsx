import { invoke } from "@tauri-apps/api/core";
import {
  ArrowClockwiseIcon as RefreshCw,
  SparkleIcon as Sparkles,
  SquareIcon as Square,
  TerminalWindowIcon as Terminal,
} from "@/ui/icons";
import {
  restartAllLanguageServers,
  stopAllLanguageServers,
} from "@/features/keymaps/commands/lsp-command-actions";
import { openAthasLogBuffer } from "@/features/settings/services/athas-log-service";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { showAlertDialog } from "@/ui/dialog";
import type { Action } from "../types/action.types";
import type { CommandPaletteViewId } from "../types/view.types";

interface AdvancedActionsParams {
  lspStatus: {
    status: string;
    activeWorkspaces: string[];
    lastError?: string | null | undefined;
  };
  vimMode: boolean;
  vimCommands: Array<{ name: string; description: string; execute: () => void }>;
  setMode: (mode: "normal" | "insert" | "visual") => void;
  openQuickEdit: (params: {
    text: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  }) => void;
  pushPaletteView: (view: CommandPaletteViewId) => void;
  showToast: (params: { message: string; type: "success" | "error" | "info" }) => void;
  onClose: () => void;
}

export const createAdvancedActions = (params: AdvancedActionsParams): Action[] => {
  const {
    lspStatus,
    vimMode,
    vimCommands,
    setMode,
    openQuickEdit,
    pushPaletteView,
    showToast,
    onClose,
  } = params;

  const baseActions: Action[] = [
    {
      id: "ai-quick-question",
      label: "AI: Quick Question",
      description: "Ask a small question using the configured AI provider",
      icon: <Sparkles />,
      category: "AI",
      action: () => {
        pushPaletteView("quick-question");
      },
    },
    {
      id: "ai-new-agent",
      label: "AI: New Agent",
      description: "Open the unified agent launcher",
      icon: <Sparkles />,
      category: "AI",
      commandId: "workbench.agentLauncher",
      action: () => {
        useUIState.getState().setIsAgentLauncherVisible(true);
        onClose();
      },
    },
    {
      id: "ai-quick-edit",
      label: "AI: Quick Edit Selection",
      description: "Edit selected text using AI inline",
      icon: <Sparkles />,
      category: "AI",
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
      icon: <Terminal />,
      category: "LSP",
      action: async () => {
        await showAlertDialog(
          `LSP Status: ${lspStatus.status}\nActive workspaces: ${lspStatus.activeWorkspaces.join(", ") || "None"}\nError: ${lspStatus.lastError || "None"}`,
          "LSP Status",
        );
        onClose();
      },
    },
    {
      id: "developer-open-athas-log",
      label: "Developer: Open Athas Log",
      description: "Open the current Athas application log in a read-only editor tab",
      icon: <Terminal />,
      category: "Developer",
      action: async () => {
        try {
          await openAthasLogBuffer();
        } catch (error) {
          showToast({
            message: error instanceof Error ? error.message : "Failed to open Athas log",
            type: "error",
          });
        }
        onClose();
      },
    },
    {
      id: "lsp.restartAllServers",
      label: "Language Server: Restart All Servers",
      description: "Restart every active language server",
      icon: <RefreshCw />,
      category: "Language Server",
      commandId: "lsp.restartAllServers",
      action: async () => {
        await restartAllLanguageServers();
        onClose();
      },
    },
    {
      id: "lsp.stopAllServers",
      label: "Language Server: Stop All Servers",
      description: "Stop every active language server",
      icon: <Square />,
      category: "Language Server",
      commandId: "lsp.stopAllServers",
      action: async () => {
        await stopAllLanguageServers();
        onClose();
      },
    },
    {
      id: "cli-install",
      label: "CLI: Install Terminal Command",
      description: "Install 'athas' command for terminal",
      icon: <Terminal />,
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
