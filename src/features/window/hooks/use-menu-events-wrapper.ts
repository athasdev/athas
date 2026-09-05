import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { isEditorKeyboardTarget } from "@/features/keymaps/utils/editor-keyboard-target";
import { useToast } from "@/features/layout/contexts/toast-context";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { OPEN_NOTIFICATIONS_COMMAND_EVENT } from "@/features/notifications/constants/notifications-events";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { splitActiveEditorGroup } from "@/features/panes/utils/pane-command-actions";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { requestWindowClose } from "@/features/window/utils/request-window-close";
import { showAlertDialog } from "@/ui/dialog";
import { writeClipboardText } from "@/utils/clipboard";
import { getServiceUrls } from "@/config/services";
import { useMenuEvents } from "./use-menu-events";

export function useMenuEventsWrapper() {
  const handleCreateNewFile = useFileSystemStore.use.handleCreateNewFile();
  const handleOpenFolder = useFileSystemStore.use.handleOpenFolder();
  const closeFolder = useFileSystemStore.use.closeFolder();
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const { closeBuffer } = useBufferStore.use.actions();
  const { handleSave } = useEditorAppStore.use.actions();
  const openWhatsNew = useWhatsNewStore((state) => state.actions.open);
  const { checkForUpdates } = useUpdater(false);
  const { showToast } = useToast();
  const isTerminalFocused = () => {
    const activeElement = document.activeElement as HTMLElement | null;
    return activeElement?.closest(".terminal-container") !== null;
  };
  const isFileTreeFocused = () => {
    const activeElement = document.activeElement as HTMLElement | null;
    return activeElement?.closest(".file-tree-container") !== null;
  };
  const shouldRouteEditMenuToEditor = () => {
    const activeElement = document.activeElement as HTMLElement | null;

    if (isEditorKeyboardTarget(activeElement)) {
      return true;
    }

    const isTextField =
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      activeElement?.isContentEditable;

    if (isTextField) {
      return false;
    }

    return useBufferStore.getState().actions.getActiveBuffer()?.type === "editor";
  };

  useMenuEvents({
    onNewWindow: () => {
      void createAppWindow();
    },
    onNewFile: () => {
      if (isTerminalFocused()) {
        window.dispatchEvent(new CustomEvent("terminal-new"));
        return;
      }
      void handleCreateNewFile();
    },
    onOpenFolder: handleOpenFolder,
    onCloseFolder: closeFolder,
    onSave: handleSave,
    onSaveAs: async () => {
      const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
      if (!activeBuffer) return;

      try {
        const result = await save({
          title: "Save As",
          defaultPath: activeBuffer.name,
          filters: [
            {
              name: "All Files",
              extensions: ["*"],
            },
            {
              name: "Text Files",
              extensions: ["txt", "md", "json", "js", "ts", "tsx", "jsx", "css", "html"],
            },
          ],
        });

        if (result) {
          // Save the active buffer content to the new file path
          try {
            await invoke("write_file", {
              path: result,
              contents: activeBuffer.type === "editor" ? activeBuffer.content : "",
            });
            console.log("File saved successfully to:", result);
            // Update buffer with new file path if needed
            // This would require updating the buffer store with the new file path
          } catch (writeError) {
            console.error("Failed to save file:", writeError);
            await showAlertDialog("Failed to save file. Please try again.", "Save As");
          }
        }
      } catch (error) {
        console.error("Save As dialog error:", error);
      }
    },
    onCloseTab: () => {
      // Check if terminal is focused - if so, dispatch event to close terminal instead
      const activeElement = document.activeElement as HTMLElement;
      const isTerminalFocused = activeElement?.closest(".terminal-container") !== null;

      if (isTerminalFocused) {
        // Dispatch a custom event that terminal-container listens to
        window.dispatchEvent(new CustomEvent("close-active-terminal"));
        return;
      }

      // Use the active pane's active buffer instead of global activeBuffer
      const paneStore = usePaneStore.getState();
      const activePane = paneStore.actions.getActivePane();
      const bufferIdToClose =
        activePane?.activeBufferId || useBufferStore.getState().actions.getActiveBuffer()?.id;

      if (bufferIdToClose) {
        closeBuffer(bufferIdToClose);
        return;
      }

      requestWindowClose();
    },
    onUndo: () => {
      if (shouldRouteEditMenuToEditor()) {
        editorAPI.undo();
        return;
      }

      document.execCommand("undo");
    },
    onRedo: () => {
      if (shouldRouteEditMenuToEditor()) {
        editorAPI.redo();
        return;
      }

      document.execCommand("redo");
    },
    onSelectAll: () => {
      if (shouldRouteEditMenuToEditor()) {
        editorAPI.selectAll();
        return;
      }

      document.execCommand("selectAll");
    },
    onFind: () => {
      if (isFileTreeFocused()) {
        window.dispatchEvent(new CustomEvent("file-tree-open-search"));
        return;
      }

      void keymapRegistry.executeCommand("workbench.showFind");
    },
    onFindReplace: () => {
      void keymapRegistry.executeCommand("workbench.showFindReplace");
    },
    onToggleComment: () => {
      void keymapRegistry.executeCommand("editor.toggleComment");
    },
    onCommandPalette: () => useUIState.getState().setIsCommandPaletteVisible(true),
    onToggleActivitySidebar: () => {
      void keymapRegistry.executeCommand("workbench.toggleActivitySidebar");
    },
    onToggleSidebar: () => {
      void keymapRegistry.executeCommand("workbench.toggleSidebar");
    },
    onToggleTerminal: () => {
      const uiState = useUIState.getState();
      const showingTerminal =
        !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "terminal";
      uiState.setBottomPaneActiveTab("terminal");
      uiState.setIsBottomPaneVisible(showingTerminal);

      if (showingTerminal) {
        window.dispatchEvent(new CustomEvent("terminal-ensure-session"));
        setTimeout(() => {
          uiState.requestTerminalFocus();
        }, 100);
      }
    },
    onSplitEditor: () => {
      splitActiveEditorGroup("horizontal");
    },
    onToggleVim: async () => {
      // For now, we'll show a notification about vim mode
      console.log("Toggle Vim keybindings");
      await showAlertDialog(
        "Vim mode is coming soon!\n\nThis will enable vim-style keybindings in the editor for power users.",
        "Vim Mode",
      );
      // In a full implementation, this would toggle vim keybinding mode in the editor
    },
    onQuickOpen: () => useUIState.getState().setIsQuickOpenVisible(true),
    onNextTab: () => {
      void keymapRegistry.executeCommand("workbench.nextTab");
    },
    onPrevTab: () => {
      void keymapRegistry.executeCommand("workbench.previousTab");
    },
    onThemeChange: (theme: string) => {
      const { settings } = useSettingsStore.getState();
      if (settings.syncSystemTheme) {
        void updateSetting("syncSystemTheme", false).then(() => updateSetting("theme", theme));
        return;
      }

      updateSetting("theme", theme);
    },
    onExecuteCommand: (commandId: string) => {
      void keymapRegistry.executeCommand(commandId);
    },
    onDocumentation: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(getServiceUrls().docsUrl);
    },
    onChangelog: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/athasdev/athas/releases");
    },
    onWhatsNew: () => {
      void openWhatsNew();
    },
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
    onOpenSettings: () => {
      useUIState.getState().openSettingsDialog("general");
    },
    onOpenExtensions: () => {
      useBufferStore.getState().actions.openExtensionsBuffer();
    },
    onToggleMenuBar: async () => {
      try {
        await invoke("toggle_menu_bar");
        console.log("Menu bar toggled successfully");
      } catch (error) {
        console.error("Failed to toggle menu bar:", error);
      }
    },
  });
}
