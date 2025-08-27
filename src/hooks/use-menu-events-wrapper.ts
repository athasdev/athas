import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { save } from "@tauri-apps/plugin-dialog";
import { useFileSystemStore } from "../file-system/controllers/store";
import { useSettingsStore } from "../settings/store";
import { useAppStore } from "../stores/app-store";
import { useBufferStore } from "../stores/buffer-store";
import { useUIState } from "../stores/ui-state-store";
import { useMenuEvents } from "./use-menu-events";

export function useMenuEventsWrapper() {
  const uiState = useUIState();
  const fileSystemStore = useFileSystemStore();
  const { settings, updateSetting } = useSettingsStore();
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { closeBuffer, switchToNextBuffer, switchToPreviousBuffer } = useBufferStore.use.actions();
  const { handleSave } = useAppStore.use.actions();

  // Get current window for window operations (currently unused but kept for future functionality)
  const _currentWindow = getCurrentWebviewWindow();

  useMenuEvents({
    onNewFile: fileSystemStore.handleCreateNewFile,
    onOpenFolder: fileSystemStore.handleOpenFolder,
    onSave: handleSave,
    onSaveAs: async () => {
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
              contents: activeBuffer.content || "",
            });
            console.log("File saved successfully to:", result);
            // Update buffer with new file path if needed
            // This would require updating the buffer store with the new file path
          } catch (writeError) {
            console.error("Failed to save file:", writeError);
            alert("Failed to save file. Please try again.");
          }
        }
      } catch (error) {
        console.error("Save As dialog error:", error);
      }
    },
    onCloseTab: () => {
      if (activeBuffer) {
        closeBuffer(activeBuffer.id);
      }
    },
    onUndo: () => {
      // Trigger browser's undo
      document.execCommand("undo");
    },
    onRedo: () => {
      // Trigger browser's redo
      document.execCommand("redo");
    },
    onFind: () => uiState.setIsFindVisible(true),
    onFindReplace: () => {
      uiState.setIsFindVisible(true);
      // Set a flag or state to indicate replace mode
      // For now, we'll show the find bar and log that replace mode should be active
      console.log("Find/Replace mode activated - find bar shown with replace functionality");
      // In a full implementation, this would enable replace input field in the find bar
    },
    onCommandPalette: () => uiState.setIsCommandPaletteVisible(true),
    onToggleSidebar: () => uiState.setIsSidebarVisible(!uiState.isSidebarVisible),
    onToggleTerminal: () => {
      const showingTerminal =
        !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "terminal";
      uiState.setBottomPaneActiveTab("terminal");
      uiState.setIsBottomPaneVisible(showingTerminal);

      // Request terminal focus after showing
      if (showingTerminal) {
        setTimeout(() => {
          uiState.requestTerminalFocus();
        }, 100);
      }
    },
    onToggleAiChat: () => updateSetting("isAIChatVisible", !settings.isAIChatVisible),
    onSplitEditor: () => {
      // For now, we'll show a notification about split editor functionality
      console.log("Split Editor - would split the current editor view");
      alert(
        "Split Editor functionality is coming soon!\n\nThis will allow you to view multiple files side by side.",
      );
      // In a full implementation, this would create a split view in the editor
    },
    onToggleVim: () => {
      // For now, we'll show a notification about vim mode
      console.log("Toggle Vim mode - would enable/disable vim keybindings");
      alert(
        "Vim mode is coming soon!\n\nThis will enable vim-style keybindings in the editor for power users.",
      );
      // In a full implementation, this would toggle vim keybinding mode in the editor
    },
    onGoToFile: () => uiState.setIsCommandBarVisible(true),
    onGoToLine: () => {
      // Simple go to line implementation using browser prompt
      const line = prompt("Go to line:");
      if (line && !Number.isNaN(Number(line))) {
        const lineNumber = parseInt(line, 10);
        console.log(`Going to line ${lineNumber}`);
        // Dispatch a custom event that the editor can listen to
        window.dispatchEvent(
          new CustomEvent("go-to-line", {
            detail: { lineNumber },
          }),
        );
        // In a full implementation, this would scroll to the specified line in the active editor
      }
    },
    onNextTab: switchToNextBuffer,
    onPrevTab: switchToPreviousBuffer,
    onThemeChange: (theme: string) => updateSetting("theme", theme),
    onAbout: () => {
      const aboutText = `Athas Code Editor
Version: 0.1.0
Built with: React, TypeScript, Tauri
License: MIT

A lightweight, fast code editor for developers.

GitHub: https://github.com/athasdev/athas`;

      alert(aboutText);
    },
    onHelp: () => {
      const helpText = `Athas Help - Keyboard Shortcuts

File:
• Ctrl+N (Cmd+N): New File
• Ctrl+O (Cmd+O): Open Folder
• Ctrl+S (Cmd+S): Save
• Ctrl+Shift+S (Cmd+Shift+S): Save As
• Ctrl+W (Cmd+W): Close Tab

Edit:
• Ctrl+Z (Cmd+Z): Undo
• Ctrl+Y (Cmd+Y): Redo
• Ctrl+F (Cmd+F): Find
• Ctrl+H (Cmd+Alt+F): Find & Replace

View:
• Ctrl+B (Cmd+B): Toggle Sidebar
• Ctrl+J (Cmd+J): Toggle Terminal
• Ctrl+R (Cmd+R): Toggle AI Chat

Go:
• Ctrl+P (Cmd+P): Go to File
• Ctrl+G (Cmd+G): Go to Line
• Ctrl+Shift+P (Cmd+Shift+P): Command Palette

For more help: https://github.com/athasdev/athas`;

      alert(helpText);
    },
    onAboutAthas: () => {
      const aboutText = `Athas Code Editor
Version: 0.1.0
Built with: React, TypeScript, Tauri
License: MIT

A lightweight, fast code editor for developers.

GitHub: https://github.com/athasdev/athas`;

      alert(aboutText);
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
