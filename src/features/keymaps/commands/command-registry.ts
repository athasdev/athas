import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useJumpListStore } from "@/features/editor/stores/jump-list-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { navigateToJumpEntry } from "@/features/editor/utils/jump-navigation";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useAppStore } from "@/stores/app-store";
import { useSearchViewStore } from "@/stores/search-view-store";
import { useUIState } from "@/stores/ui-state-store";
import { useZoomStore } from "@/stores/zoom-store";
import { isMac } from "@/utils/platform";
import type { Command } from "../types";
import { keymapRegistry } from "../utils/registry";

const fileCommands: Command[] = [
  {
    id: "file.save",
    title: "Save File",
    category: "File",
    keybinding: "cmd+s",
    execute: () => {
      useAppStore.getState().actions.handleSave();
    },
  },
  {
    id: "file.saveAs",
    title: "Save File As",
    category: "File",
    keybinding: "cmd+shift+s",
    execute: async () => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);

      if (!activeBuffer) return;

      const result = await save({
        title: "Save As",
        defaultPath: activeBuffer.name,
        filters: [
          { name: "All Files", extensions: ["*"] },
          {
            name: "Text Files",
            extensions: ["txt", "md", "json", "js", "ts", "tsx", "jsx", "css", "html"],
          },
        ],
      });

      if (result) {
        await invoke("write_file", { path: result, contents: activeBuffer.content || "" });
      }
    },
  },
  {
    id: "file.close",
    title: "Close Tab",
    category: "File",
    keybinding: "cmd+w",
    execute: () => {
      const terminalContainer = document.querySelector('[data-terminal-container="active"]');
      if (terminalContainer?.contains(document.activeElement)) return;

      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
      if (activeBuffer) {
        bufferStore.actions.closeBuffer(activeBuffer.id);
      }
    },
  },
  {
    id: "file.closeAll",
    title: "Close All Tabs",
    category: "File",
    execute: () => {
      const bufferStore = useBufferStore.getState();
      bufferStore.actions.closeBuffersBatch(
        bufferStore.buffers.map((b) => b.id),
        true,
      );
    },
  },
  {
    id: "file.reopenClosed",
    title: "Reopen Closed Tab",
    category: "File",
    keybinding: "cmd+shift+t",
    execute: async () => {
      await useBufferStore.getState().actions.reopenClosedTab();
    },
  },
  {
    id: "file.new",
    title: "New File",
    category: "File",
    keybinding: "cmd+n",
    execute: () => {
      useFileSystemStore.getState().handleCreateNewFile();
    },
  },
  {
    id: "file.open",
    title: "Open Project",
    category: "File",
    keybinding: "cmd+o",
    execute: () => {
      useUIState.getState().setIsProjectPickerVisible(true);
    },
  },
  {
    id: "file.quickOpen",
    title: "Quick Open",
    category: "File",
    keybinding: "cmd+p",
    execute: () => {
      useUIState.getState().setIsCommandBarVisible(true);
    },
  },
];

const editCommands: Command[] = [
  {
    id: "editor.selectAll",
    title: "Select All",
    category: "Edit",
    keybinding: "cmd+a",
    execute: () => editorAPI.selectAll(),
  },
  {
    id: "editor.undo",
    title: "Undo",
    category: "Edit",
    keybinding: "cmd+z",
    execute: () => editorAPI.undo(),
  },
  {
    id: "editor.redo",
    title: "Redo",
    category: "Edit",
    keybinding: "cmd+shift+z",
    execute: () => editorAPI.redo(),
  },
  {
    id: "editor.copy",
    title: "Copy",
    category: "Edit",
    keybinding: "cmd+c",
    execute: () => document.execCommand("copy"),
  },
  {
    id: "editor.cut",
    title: "Cut",
    category: "Edit",
    keybinding: "cmd+x",
    execute: () => document.execCommand("cut"),
  },
  {
    id: "editor.paste",
    title: "Paste",
    category: "Edit",
    keybinding: "cmd+v",
    execute: async () => {
      const text = await navigator.clipboard.readText();
      const textarea = editorAPI.getTextareaRef();
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
  },
  {
    id: "editor.duplicateLine",
    title: "Duplicate Line",
    category: "Edit",
    keybinding: "cmd+d",
    execute: () => editorAPI.duplicateLine(),
  },
  {
    id: "editor.deleteLine",
    title: "Delete Line",
    category: "Edit",
    keybinding: "cmd+shift+k",
    execute: () => editorAPI.deleteLine(),
  },
  {
    id: "editor.toggleComment",
    title: "Toggle Comment",
    category: "Edit",
    keybinding: "cmd+/",
    execute: () => editorAPI.toggleComment(),
  },
  {
    id: "editor.moveLineUp",
    title: "Move Line Up",
    category: "Edit",
    keybinding: "alt+up",
    execute: () => editorAPI.moveLineUp(),
  },
  {
    id: "editor.moveLineDown",
    title: "Move Line Down",
    category: "Edit",
    keybinding: "alt+down",
    execute: () => editorAPI.moveLineDown(),
  },
  {
    id: "editor.copyLineUp",
    title: "Copy Line Up",
    category: "Edit",
    keybinding: "alt+shift+up",
    execute: () => editorAPI.copyLineUp(),
  },
  {
    id: "editor.copyLineDown",
    title: "Copy Line Down",
    category: "Edit",
    keybinding: "alt+shift+down",
    execute: () => editorAPI.copyLineDown(),
  },
  {
    id: "editor.formatDocument",
    title: "Format Document",
    category: "Edit",
    keybinding: "shift+alt+f",
    execute: () => {},
  },
];

const toggleTerminalPane = () => {
  const state = useUIState.getState();
  if (state.isBottomPaneVisible && state.bottomPaneActiveTab === "terminal") {
    state.setIsBottomPaneVisible(false);
  } else {
    state.setBottomPaneActiveTab("terminal");
    state.setIsBottomPaneVisible(true);
    setTimeout(() => state.requestTerminalFocus(), 100);
  }
};

const viewCommands: Command[] = [
  {
    id: "workbench.toggleSidebar",
    title: "Toggle Sidebar",
    category: "View",
    keybinding: "cmd+b",
    execute: () => {
      const state = useUIState.getState();
      state.setIsSidebarVisible(!state.isSidebarVisible);
    },
  },
  {
    id: "workbench.toggleTerminal",
    title: "Toggle Terminal",
    category: "View",
    keybinding: "cmd+j",
    execute: toggleTerminalPane,
  },
  {
    id: "workbench.toggleTerminalAlt",
    title: "Toggle Terminal (Alt)",
    category: "View",
    keybinding: "cmd+`",
    execute: toggleTerminalPane,
  },
  {
    id: "workbench.toggleDiagnostics",
    title: "Toggle Diagnostics",
    category: "View",
    keybinding: "cmd+shift+j",
    execute: () => {
      const state = useUIState.getState();
      if (state.isBottomPaneVisible && state.bottomPaneActiveTab === "diagnostics") {
        state.setIsBottomPaneVisible(false);
      } else {
        state.setBottomPaneActiveTab("diagnostics");
        state.setIsBottomPaneVisible(true);
      }
    },
  },
  {
    id: "workbench.commandPalette",
    title: "Command Palette",
    category: "View",
    keybinding: "cmd+shift+p",
    execute: () => {
      const state = useUIState.getState();
      state.setIsCommandPaletteVisible(!state.isCommandPaletteVisible);
    },
  },
  {
    id: "workbench.showFind",
    title: "Find",
    category: "View",
    keybinding: "cmd+f",
    execute: () => {
      const state = useUIState.getState();
      state.setIsFindVisible(!state.isFindVisible);
    },
  },
  {
    id: "workbench.showGlobalSearch",
    title: "Global Search",
    category: "View",
    keybinding: "cmd+shift+f",
    execute: () => {
      const state = useUIState.getState();
      state.setIsGlobalSearchVisible(!state.isGlobalSearchVisible);
    },
  },
  {
    id: "workbench.showProjectSearch",
    title: "Project Search",
    category: "View",
    keybinding: "cmd+shift+h",
    execute: () => {
      const uiState = useUIState.getState();
      uiState.setIsSidebarVisible(true);
      uiState.setIsSearchViewActive(true);
      setTimeout(() => useSearchViewStore.getState().focusSearchInput(), 100);
    },
  },
  {
    id: "workbench.toggleSidebarPosition",
    title: "Toggle Sidebar Position",
    category: "View",
    keybinding: "cmd+shift+b",
    execute: () => {
      const { settings, updateSetting } = useSettingsStore.getState();
      updateSetting("sidebarPosition", settings.sidebarPosition === "left" ? "right" : "left");
    },
  },
  {
    id: "workbench.showThemeSelector",
    title: "Theme Selector",
    category: "View",
    keybinding: "cmd+k cmd+t",
    execute: () => {
      useUIState.getState().setIsThemeSelectorVisible(true);
    },
  },
  {
    id: "workbench.toggleAIChat",
    title: "Toggle AI Chat",
    category: "View",
    keybinding: "cmd+r",
    execute: () => {
      const { settings, updateSetting } = useSettingsStore.getState();
      updateSetting("isAIChatVisible", !settings.isAIChatVisible);
    },
  },
  {
    id: "workbench.toggleMinimap",
    title: "Toggle Minimap",
    category: "View",
    keybinding: "cmd+shift+m",
    execute: () => {
      const { settings, updateSetting } = useSettingsStore.getState();
      updateSetting("showMinimap", !settings.showMinimap);
    },
  },
  {
    id: "workbench.zoomIn",
    title: "Zoom In",
    category: "View",
    keybinding: "cmd+=",
    execute: () => {
      const terminalContainer = document.querySelector('[data-terminal-container="active"]');
      const isTerminalFocused = terminalContainer?.contains(document.activeElement);
      useZoomStore.getState().actions.zoomIn(isTerminalFocused ? "terminal" : "window");
    },
  },
  {
    id: "workbench.zoomOut",
    title: "Zoom Out",
    category: "View",
    keybinding: "cmd+-",
    execute: () => {
      const terminalContainer = document.querySelector('[data-terminal-container="active"]');
      const isTerminalFocused = terminalContainer?.contains(document.activeElement);
      useZoomStore.getState().actions.zoomOut(isTerminalFocused ? "terminal" : "window");
    },
  },
  {
    id: "workbench.zoomReset",
    title: "Reset Zoom",
    category: "View",
    keybinding: "cmd+0",
    execute: () => {
      const terminalContainer = document.querySelector('[data-terminal-container="active"]');
      const isTerminalFocused = terminalContainer?.contains(document.activeElement);
      useZoomStore.getState().actions.resetZoom(isTerminalFocused ? "terminal" : "window");
    },
  },
  {
    id: "workbench.openKeyboardShortcuts",
    title: "Open Keyboard Shortcuts",
    category: "View",
    keybinding: "cmd+k cmd+s",
    execute: () => {
      useUIState.getState().openSettingsDialog("keyboard");
    },
  },
];

const navigationCommands: Command[] = [
  {
    id: "editor.goToLine",
    title: "Go to Line",
    category: "Navigation",
    keybinding: "cmd+g",
    execute: () => {
      window.dispatchEvent(new CustomEvent("menu-go-to-line"));
    },
  },
  {
    id: "workbench.nextTab",
    title: "Next Tab",
    category: "Navigation",
    keybinding: "cmd+alt+right",
    execute: () => useBufferStore.getState().actions.switchToNextBuffer(),
  },
  {
    id: "workbench.nextTabCtrlTab",
    title: "Next Tab (Ctrl+Tab)",
    category: "Navigation",
    keybinding: "ctrl+tab",
    execute: () => useBufferStore.getState().actions.switchToNextBuffer(),
  },
  {
    id: "workbench.previousTab",
    title: "Previous Tab",
    category: "Navigation",
    keybinding: "cmd+alt+left",
    execute: () => useBufferStore.getState().actions.switchToPreviousBuffer(),
  },
  {
    id: "workbench.previousTabCtrlTab",
    title: "Previous Tab (Ctrl+Shift+Tab)",
    category: "Navigation",
    keybinding: "ctrl+shift+tab",
    execute: () => useBufferStore.getState().actions.switchToPreviousBuffer(),
  },
  {
    id: "workbench.nextTabAlt",
    title: "Next Tab (Alt)",
    category: "Navigation",
    keybinding: "ctrl+pagedown",
    execute: () => useBufferStore.getState().actions.switchToNextBuffer(),
  },
  {
    id: "workbench.previousTabAlt",
    title: "Previous Tab (Alt)",
    category: "Navigation",
    keybinding: "ctrl+pageup",
    execute: () => useBufferStore.getState().actions.switchToPreviousBuffer(),
  },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `workbench.switchToTab${i + 1}`,
    title: `Switch to Tab ${i + 1}`,
    category: "Navigation",
    keybinding: `cmd+${i + 1}`,
    execute: () => {
      const bufferStore = useBufferStore.getState();
      const buffer = bufferStore.buffers[i];
      if (buffer) bufferStore.actions.setActiveBuffer(buffer.id);
    },
  })),
  {
    id: "editor.goToDefinition",
    title: "Go to Definition",
    category: "Navigation",
    keybinding: "F12",
    execute: async () => {
      const { LspClient } = await import("@/features/editor/lsp/lsp-client");
      const { readFileContent } = await import(
        "@/features/file-system/controllers/file-operations"
      );

      const lspClient = LspClient.getInstance();
      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
      const editorState = useEditorStateStore.getState();
      const cursorPosition = editorState.cursorPosition;

      if (!activeBuffer?.path) return;

      const definition = await lspClient.getDefinition(
        activeBuffer.path,
        cursorPosition.line,
        cursorPosition.column,
      );

      if (definition && definition.length > 0) {
        // Push current position to jump list before navigating
        useJumpListStore.getState().actions.pushEntry({
          bufferId: activeBuffer.id,
          filePath: activeBuffer.path,
          line: cursorPosition.line,
          column: cursorPosition.column,
          offset: cursorPosition.offset,
          scrollTop: editorState.scrollTop,
          scrollLeft: editorState.scrollLeft,
        });

        const target = definition[0];
        const filePath = target.uri.replace("file://", "");
        const existingBuffer = bufferStore.buffers.find((b) => b.path === filePath);

        if (existingBuffer) {
          bufferStore.actions.setActiveBuffer(existingBuffer.id);
        } else {
          const content = await readFileContent(filePath);
          const fileName = filePath.split("/").pop() || "untitled";
          const bufferId = bufferStore.actions.openBuffer(filePath, fileName, content);
          bufferStore.actions.setActiveBuffer(bufferId);
        }

        setTimeout(() => {
          const lines = editorAPI.getLines();
          let offset = 0;
          for (let i = 0; i < target.range.start.line; i++) {
            offset += lines[i].length + 1;
          }
          offset += target.range.start.character;

          editorAPI.setCursorPosition({
            line: target.range.start.line,
            column: target.range.start.character,
            offset,
          });
        }, 100);
      }
    },
  },
  {
    id: "editor.goToReferences",
    title: "Go to References",
    category: "Navigation",
    keybinding: "shift+F12",
    execute: async () => {
      const { LspClient } = await import("@/features/editor/lsp/lsp-client");

      const lspClient = LspClient.getInstance();
      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
      const cursorPosition = useEditorStateStore.getState().cursorPosition;

      if (!activeBuffer?.path) return;

      const references = await lspClient.getReferences(
        activeBuffer.path,
        cursorPosition.line,
        cursorPosition.column,
      );

      if (references && references.length > 0) {
        console.log(`Found ${references.length} references:`, references);
      }
    },
  },
  {
    id: "navigation.goBack",
    title: "Go Back",
    category: "Navigation",
    keybinding: "ctrl+-",
    execute: async () => {
      const bufferStore = useBufferStore.getState();
      const editorState = useEditorStateStore.getState();
      const activeBufferId = bufferStore.activeBufferId;
      const activeBuffer = bufferStore.buffers.find((b) => b.id === activeBufferId);

      const currentPosition =
        activeBufferId && activeBuffer?.path
          ? {
              bufferId: activeBufferId,
              filePath: activeBuffer.path,
              line: editorState.cursorPosition.line,
              column: editorState.cursorPosition.column,
              offset: editorState.cursorPosition.offset,
              scrollTop: editorState.scrollTop,
              scrollLeft: editorState.scrollLeft,
            }
          : undefined;

      const entry = useJumpListStore.getState().actions.goBack(currentPosition);
      if (entry) {
        await navigateToJumpEntry(entry);
      }
    },
  },
  {
    id: "navigation.goForward",
    title: "Go Forward",
    category: "Navigation",
    keybinding: "ctrl+shift+-",
    execute: async () => {
      const entry = useJumpListStore.getState().actions.goForward();
      if (entry) {
        await navigateToJumpEntry(entry);
      }
    },
  },
];

const windowCommands: Command[] = [
  {
    id: "window.toggleFullscreen",
    title: "Toggle Fullscreen",
    category: "Window",
    keybinding: "F11",
    execute: () => {
      window.dispatchEvent(new CustomEvent("toggle-fullscreen"));
    },
  },
  {
    id: "window.toggleFullscreenMac",
    title: "Toggle Fullscreen (Mac)",
    category: "Window",
    keybinding: "cmd+ctrl+f",
    execute: () => {
      if (isMac()) window.dispatchEvent(new CustomEvent("toggle-fullscreen"));
    },
  },
  {
    id: "window.minimize",
    title: "Minimize Window",
    category: "Window",
    execute: () => {
      window.dispatchEvent(new CustomEvent("minimize-window"));
    },
  },
  {
    id: "window.minimize.mac",
    title: "Minimize (Mac)",
    category: "Window",
    keybinding: "cmd+m",
    execute: () => {
      if (isMac()) window.dispatchEvent(new CustomEvent("minimize-window"));
    },
  },
  {
    id: "window.minimize.alt",
    title: "Minimize (Alt)",
    category: "Window",
    keybinding: "alt+F9",
    execute: () => {
      if (!isMac()) window.dispatchEvent(new CustomEvent("minimize-window"));
    },
  },
  {
    id: "window.maximize",
    title: "Maximize Window",
    category: "Window",
    keybinding: "alt+F10",
    execute: () => {
      if (!isMac()) window.dispatchEvent(new CustomEvent("maximize-window"));
    },
  },
  {
    id: "window.quit",
    title: "Quit Application",
    category: "Window",
    keybinding: "cmd+q",
    execute: async () => {
      if (isMac()) {
        const { exit } = await import("@tauri-apps/plugin-process");
        exit(0);
      }
    },
  },
  {
    id: "window.toggleMenuBar",
    title: "Toggle Menu Bar",
    category: "Window",
    keybinding: "alt+m",
    execute: async () => {
      if (!isMac()) {
        const { settings } = useSettingsStore.getState();
        if (settings.nativeMenuBar) {
          const { invoke } = await import("@tauri-apps/api/core");
          invoke("toggle_menu_bar").catch(console.error);
        }
      }
    },
  },
];

export const allCommands: Command[] = [
  ...fileCommands,
  ...editCommands,
  ...viewCommands,
  ...navigationCommands,
  ...windowCommands,
];

export function registerCommands(): void {
  for (const command of allCommands) {
    keymapRegistry.registerCommand(command);
  }
}
