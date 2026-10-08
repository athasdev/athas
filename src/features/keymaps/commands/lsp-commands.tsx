import { ArrowClockwiseIcon, SquareIcon, TerminalWindowIcon } from "@/ui/icons";
import { installCli } from "@/features/settings/services/cli-install-service";
import { useLspStore } from "@/features/editor/lsp/stores/lsp.store";
import { showToast } from "@/utils/toast";
import type { Command } from "../types/keymaps.types";
import {
  organizeJavaImports,
  refreshJavaProject,
  restartAllLanguageServers,
  stopAllLanguageServers,
} from "./lsp-command-actions";

export const lspCommands: Command[] = [
  {
    id: "java.organizeImports",
    title: "Java: Organize Imports",
    category: "Java",
    execute: organizeJavaImports,
  },
  {
    id: "java.refreshProject",
    title: "Java: Refresh Project",
    category: "Java",
    execute: refreshJavaProject,
  },
  {
    id: "lsp.restartAllServers",
    title: "Language Server: Restart All Servers",
    category: "Language Server",
    description: "Restart every active language server",
    icon: <ArrowClockwiseIcon />,
    palette: { closePalette: "settled" },
    execute: () => restartAllLanguageServers(),
  },
  {
    id: "lsp.stopAllServers",
    title: "Language Server: Stop All Servers",
    category: "Language Server",
    description: "Stop every active language server",
    icon: <SquareIcon />,
    palette: { closePalette: "settled" },
    execute: () => stopAllLanguageServers(),
  },
  {
    id: "lsp.showStatus",
    title: "LSP: Show Status",
    category: "LSP",
    icon: <TerminalWindowIcon />,
    palette: ({ lspStatus }) => ({
      description: `Status: ${lspStatus.status} (${lspStatus.activeWorkspaces.length} workspaces)`,
      closePalette: "settled",
    }),
    execute: async () => {
      const { showAlertDialog } = await import("@/ui/dialog");
      const { lspStatus } = useLspStore.getState();
      await showAlertDialog(
        `LSP Status: ${lspStatus.status}\nActive workspaces: ${lspStatus.activeWorkspaces.join(", ") || "None"}\nError: ${lspStatus.lastError || "None"}`,
        "LSP Status",
      );
    },
  },
];

export const developerCommands: Command[] = [
  {
    id: "developer.openAthasLog",
    title: "Developer: Open Athas Log",
    category: "Developer",
    description: "Open the current Athas application log in a read-only editor tab",
    icon: <TerminalWindowIcon />,
    palette: { closePalette: "settled" },
    execute: async () => {
      try {
        const { openAthasLogBuffer } =
          await import("@/features/settings/services/athas-log-service");
        await openAthasLogBuffer();
      } catch (error) {
        showToast({
          message: error instanceof Error ? error.message : "Failed to open Athas log",
          type: "error",
        });
      }
    },
  },
  {
    id: "cli.installTerminalCommand",
    title: "CLI: Install Terminal Command",
    category: "CLI",
    description: "Install 'athas' command for terminal",
    icon: <TerminalWindowIcon />,
    palette: { closePalette: "settled" },
    execute: async () => {
      try {
        showToast({ message: "Installing CLI command...", type: "info" });
        const result = await installCli();
        showToast({ message: result, type: "success" });
      } catch (error) {
        showToast({
          message: `Failed to install CLI: ${error}. You may need administrator privileges.`,
          type: "error",
        });
      }
    },
  },
];
