import { invoke } from "@tauri-apps/api/core";
import { logOutOfAcpAgent } from "@/features/ai/lib/acp-logout";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";
import { openAgentSessions } from "@/features/ai/lib/open-agent-sessions";
import { openAgentInNewWindow } from "@/features/ai/detached/agent-window-service";
import { toggleFollowAgent } from "@/features/ai/services/agent-follow-service";
import { keepAllAgentEdits, rejectAllAgentEdits } from "@/features/ai/services/agent-edits-service";
import { pickAgentEditsChatId, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  ArrowsLeftRightIcon,
  CheckIcon,
  CrosshairIcon,
  GitDiffIcon,
  HistoryIcon,
  SignOutIcon,
  SparkleIcon,
  SquareIcon,
  TerminalWindowIcon,
  XIcon,
} from "@/ui/icons";
import {
  restartAllLanguageServers,
  stopAllLanguageServers,
} from "@/features/keymaps/commands/lsp-command-actions";
import { openAthasLogBuffer } from "@/features/settings/services/athas-log-service";
import { showAlertDialog } from "@/ui/dialog";
import type { Action } from "../types/action.types";

interface AdvancedActionsParams {
  lspStatus: {
    status: string;
    activeWorkspaces: string[];
    lastError?: string | null | undefined;
  };
  /** The current chat's running agent, when it advertises ACP logout. */
  logOutAgentId: string | null;
  /** The current chat's running agent, when it lists its sessions (ACP `session/list`). */
  browseSessionsAgentId: string | null;
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
    logOutAgentId,
    browseSessionsAgentId,
    vimMode,
    vimCommands,
    setMode,
    openQuickEdit,
    showToast,
    onClose,
  } = params;

  const baseActions: Action[] = [
    {
      id: "ai-open-agent-window",
      label: "AI: Open Agent in New Window",
      description: "Open the active agent session in its own window",
      icon: <SparkleIcon />,
      category: "AI",
      action: async () => {
        onClose();
        const state = useBufferStore.getState();
        const buffer = state.buffers.find((item) => item.id === state.activeBufferId);
        if (buffer?.type === "agent") await openAgentInNewWindow(buffer.sessionId);
        else showToast({ message: "Open an agent tab first.", type: "info" });
      },
    },
    {
      id: "ai-toggle-follow-agent",
      label: "AI: Toggle Follow Agent",
      description: "Open the files the agent works in while its turn runs",
      icon: <CrosshairIcon />,
      category: "AI",
      action: () => {
        onClose();
        const state = useBufferStore.getState();
        const buffer = state.buffers.find((item) => item.id === state.activeBufferId);
        const chatId =
          buffer?.type === "agent" ? buffer.sessionId : useAIChatStore.getState().currentChatId;
        if (!chatId) {
          showToast({ message: "Open an agent tab first.", type: "info" });
          return;
        }
        const following = toggleFollowAgent(chatId);
        showToast({
          message: following ? "Following the agent" : "Stopped following the agent",
          type: "info",
        });
      },
    },
    ...(
      [
        {
          id: "ai-review-agent-changes",
          label: "AI: Review Agent Changes",
          description: "Keep or reject the agent's file edits hunk by hunk",
          icon: <GitDiffIcon />,
          run: (chatId: string) => useAgentEditsStore.getState().actions.openReview(chatId),
        },
        {
          id: "ai-keep-all-agent-changes",
          label: "AI: Keep All Agent Changes",
          description: "Accept every unreviewed edit the agent made",
          icon: <CheckIcon />,
          run: (chatId: string) => void keepAllAgentEdits(chatId),
        },
        {
          id: "ai-reject-all-agent-changes",
          label: "AI: Reject All Agent Changes",
          description: "Revert every unreviewed edit the agent made",
          icon: <XIcon />,
          run: (chatId: string) => void rejectAllAgentEdits(chatId),
        },
      ] as const
    ).map(({ run, ...command }): Action => ({
      ...command,
      category: "AI",
      action: () => {
        onClose();
        const state = useBufferStore.getState();
        const buffer = state.buffers.find((item) => item.id === state.activeBufferId);
        const chatId = pickAgentEditsChatId(
          buffer?.type === "agent" ? buffer.sessionId : useAIChatStore.getState().currentChatId,
        );
        if (!chatId) {
          showToast({ message: "No agent changes to review.", type: "info" });
          return;
        }
        run(chatId);
      },
    })),
    {
      id: "ai-new-agent",
      label: "AI: New Agent",
      description: "Open a new agent chat",
      icon: <SparkleIcon />,
      category: "AI",
      commandId: "workbench.agentLauncher",
      action: () => {
        openNewAgentChat();
        onClose();
      },
    },
    {
      id: "ai-continuous-agents",
      label: "AI: Continuous Agents",
      description: "Create and manage recurring workspace goals",
      icon: <ArrowsClockwiseIcon />,
      category: "AI",
      action: () => {
        useBufferStore.getState().actions.openContinuousAgentsBuffer();
        onClose();
      },
    },
    {
      id: "ai-open-acp-inspector",
      label: "AI: Open ACP Inspector",
      description: "Inspect the JSON-RPC traffic and capabilities of running ACP agents",
      icon: <ArrowsLeftRightIcon />,
      category: "AI",
      action: () => {
        useBufferStore.getState().actions.openAcpInspectorBuffer();
        onClose();
      },
    },
    ...(browseSessionsAgentId
      ? [
          {
            id: "ai-import-agent-session",
            label: "AI: Import Agent Session",
            description: "Browse the agent's sessions for this workspace and open one",
            icon: <HistoryIcon />,
            category: "AI",
            action: () => {
              onClose();
              openAgentSessions(browseSessionsAgentId);
            },
          },
        ]
      : []),
    ...(logOutAgentId
      ? [
          {
            id: "ai-log-out-agent",
            label: "AI: Log Out of Agent",
            description: "Sign out of the running agent; the next prompt asks how to sign in",
            icon: <SignOutIcon />,
            category: "AI",
            action: () => {
              onClose();
              void logOutOfAcpAgent(logOutAgentId);
            },
          },
        ]
      : []),
    {
      id: "ai-quick-edit",
      label: "AI: Quick Edit Selection",
      description: "Edit selected text using AI inline",
      icon: <SparkleIcon />,
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
      icon: <TerminalWindowIcon />,
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
      icon: <TerminalWindowIcon />,
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
      icon: <ArrowClockwiseIcon />,
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
      icon: <SquareIcon />,
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
      icon: <TerminalWindowIcon />,
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
