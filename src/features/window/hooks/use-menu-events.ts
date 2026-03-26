import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef } from "react";

function cleanupMenuListeners() {
  if (!listenersAreSetup) return;

  cleanupFunctions.forEach((cleanup) => cleanup());

  cleanupFunctions = [];
  listenersAreSetup = false;
  currentHandlers = null;
}

let listenersAreSetup = false;
let currentHandlers: any = null;
let cleanupFunctions: UnlistenFn[] = [];

async function setupMenuListeners(handlers: any) {
  if (listenersAreSetup) {
    currentHandlers = handlers;
    return;
  }

  listenersAreSetup = true;
  currentHandlers = handlers;
  const currentWindow = getCurrentWebviewWindow();

  const removeListeners = await Promise.all([
    currentWindow.listen("menu_new_window", () => currentHandlers.current.onNewWindow()),
    currentWindow.listen("menu_new_file", () => currentHandlers.current.onNewFile()),
    currentWindow.listen("menu_open_folder", () => currentHandlers.current.onOpenFolder()),
    currentWindow.listen("menu_close_folder", () => currentHandlers.current.onCloseFolder()),
    currentWindow.listen("menu_save", () => currentHandlers.current.onSave()),
    currentWindow.listen("menu_save_as", () => currentHandlers.current.onSaveAs()),
    currentWindow.listen("menu_close_tab", () => currentHandlers.current.onCloseTab()),
    currentWindow.listen("menu_undo", () => currentHandlers.current.onUndo()),
    currentWindow.listen("menu_redo", () => currentHandlers.current.onRedo()),
    currentWindow.listen("menu_find", () => currentHandlers.current.onFind()),
    currentWindow.listen("menu_find_replace", () => currentHandlers.current.onFindReplace()),
    currentWindow.listen("menu_command_palette", () => currentHandlers.current.onCommandPalette()),
    currentWindow.listen("menu_toggle_sidebar", () => currentHandlers.current.onToggleSidebar()),
    currentWindow.listen("menu_toggle_terminal", () => currentHandlers.current.onToggleTerminal()),
    currentWindow.listen("menu_toggle_ai_chat", () => currentHandlers.current.onToggleAiChat()),
    currentWindow.listen("menu_split_editor", () => currentHandlers.current.onSplitEditor()),
    currentWindow.listen("menu_toggle_vim", () => currentHandlers.current.onToggleVim()),
    currentWindow.listen("menu_quick_open", () => currentHandlers.current.onQuickOpen()),
    currentWindow.listen("menu_go_to_line", () => currentHandlers.current.onGoToLine()),
    currentWindow.listen("menu_next_tab", () => currentHandlers.current.onNextTab()),
    currentWindow.listen("menu_prev_tab", () => currentHandlers.current.onPrevTab()),
    currentWindow.listen("menu_theme_change", (event) =>
      currentHandlers.current.onThemeChange(event.payload as string),
    ),
    currentWindow.listen("menu_about", () => currentHandlers.current.onAbout()),
    currentWindow.listen("menu_help", () => currentHandlers.current.onHelp()),
    currentWindow.listen("menu_report_bug", () => currentHandlers.current.onReportBug()),
    currentWindow.listen("menu_about_athas", () => currentHandlers.current.onAboutAthas()),
    currentWindow.listen("menu_toggle_menu_bar", () => currentHandlers.current.onToggleMenuBar()),
  ]);

  cleanupFunctions = removeListeners;

  window.addEventListener("beforeunload", cleanupMenuListeners);
}

interface UseMenuEventsProps {
  onNewWindow: () => void;
  onNewFile: () => void;
  onOpenFolder: () => void;
  onCloseFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseTab: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
  onFindReplace: () => void;
  onCommandPalette: () => void;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  onToggleAiChat: () => void;
  onSplitEditor: () => void;
  onToggleVim: () => void;
  onQuickOpen: () => void;
  onGoToLine: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
  onThemeChange: (theme: string) => void;
  onAbout: () => void | Promise<void>;
  onHelp: () => void;
  onReportBug: () => void | Promise<void>;
  onAboutAthas: () => void | Promise<void>;
  onToggleMenuBar: () => void;
}

export function useMenuEvents(props: UseMenuEventsProps) {
  const handlersRef = useRef(props);

  handlersRef.current = props;

  useEffect(() => {
    setupMenuListeners(handlersRef);

    return () => {
      cleanupMenuListeners();
      window.removeEventListener("beforeunload", cleanupMenuListeners);
    };
  }, []);
}
