import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { executeCommandWithFeedback } from "@/features/keymaps/utils/execute-command-with-feedback";
import { OPEN_NOTIFICATIONS_COMMAND_EVENT } from "@/features/notifications/constants/notifications-events";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { writeClipboardText } from "@/utils/clipboard";
import { getServiceUrls } from "@/config/services";
import { useMenuEvents } from "./use-menu-events";

/** Menu items run the same registered command as their keyboard shortcut. */
const runCommand = (commandId: string) => () => {
  void executeCommandWithFeedback(commandId);
};

export function useMenuEventsWrapper() {
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const closeFolder = useFileSystemStore.use.closeFolder();
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const { checkForUpdates } = useUpdater(false);
  const { showToast } = useToast();

  useMenuEvents({
    onNewWindow: runCommand("workbench.newWindow"),
    onNewFile: runCommand("file.new"),
    onOpenFolder: handleOpenFolder,
    onCloseFolder: closeFolder,
    onSave: runCommand("file.save"),
    onSaveAs: runCommand("file.saveAs"),
    onCloseTab: runCommand("file.close"),
    onUndo: runCommand("editor.undo"),
    onRedo: runCommand("editor.redo"),
    onSelectAll: runCommand("editor.selectAll"),
    onFind: runCommand("workbench.showFind"),
    onFindReplace: runCommand("workbench.showFindReplace"),
    onToggleComment: runCommand("editor.toggleComment"),
    onCommandPalette: runCommand("workbench.commandPalette"),
    onToggleSidebar: runCommand("workbench.toggleSidebar"),
    onToggleTerminal: runCommand("workbench.toggleTerminal"),
    onSplitEditor: runCommand("workbench.splitEditorRight"),
    onToggleVim: runCommand("settings.toggleVimMode"),
    onQuickOpen: runCommand("file.quickOpen"),
    onNextTab: runCommand("workbench.nextTab"),
    onPrevTab: runCommand("workbench.previousTab"),
    onThemeChange: (theme: string) => {
      const { settings } = useSettingsStore.getState();
      if (settings.syncSystemTheme) {
        void updateSetting("syncSystemTheme", false).then(() => updateSetting("theme", theme));
        return;
      }

      updateSetting("theme", theme);
    },
    onExecuteCommand: (commandId: string) => {
      void executeCommandWithFeedback(commandId);
    },
    onDocumentation: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(getServiceUrls().docsUrl);
    },
    onChangelog: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/athasdev/athas/releases");
    },
    onWhatsNew: runCommand("help.showWhatsNew"),
    onReportBug: async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        let osSummary = "";
        try {
          const os = await import("@tauri-apps/plugin-os");
          const plat = os.platform();
          const ver = os.version();
          osSummary = `${plat} ${ver}`;
        } catch {
          osSummary = navigator.userAgent;
        }

        const text = `Environment\n\n- App: Athas ${version}\n- OS: ${osSummary}\n\nProblem\n\nDescribe the issue here. Steps to reproduce, expected vs actual.\n`;
        await writeClipboardText(text);

        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl("https://github.com/athasdev/athas/issues/new?template=01-bug.yml");
      } catch (e) {
        console.error("Failed to prepare bug report:", e);
      }
    },
    onRequestFeature: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/athasdev/athas/issues/new?template=02-feature.yml");
    },
    onCheckForUpdates: async () => {
      const hasUpdate = await checkForUpdates({ ignoreSuppression: true });
      if (!hasUpdate) {
        showToast({ message: "You're on the latest version", type: "success" });
      }
    },
    onOpenGitHubNotifications: () => {
      window.dispatchEvent(
        new CustomEvent(OPEN_NOTIFICATIONS_COMMAND_EVENT, {
          detail: { category: "github" },
        }),
      );
    },
    onOpenSettings: runCommand("workbench.openSettings"),
    onOpenExtensions: runCommand("view.showIntegrations"),
    onToggleMenuBar: runCommand("window.toggleMenuBar"),
  });
}
