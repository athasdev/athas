import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

  const removeListeners = await Promise.all([
    listen("menu_new_file", () => currentHandlers.current.onNewFile()),
    listen("menu_open_folder", () => currentHandlers.current.onOpenFolder()),
    listen("menu_close_folder", () => currentHandlers.current.onCloseFolder()),
    listen("menu_save", () => currentHandlers.current.onSave()),
    listen("menu_save_as", () => currentHandlers.current.onSaveAs()),
    listen("menu_close_tab", () => currentHandlers.current.onCloseTab()),
    listen("menu_undo", () => currentHandlers.current.onUndo()),
    listen("menu_redo", () => currentHandlers.current.onRedo()),
    listen("menu_find", () => currentHandlers.current.onFind()),
    listen("menu_find_replace", () => currentHandlers.current.onFindReplace()),
    listen("menu_command_palette", () => currentHandlers.current.onCommandPalette()),
    listen("menu_toggle_sidebar", () => currentHandlers.current.onToggleSidebar()),
    listen("menu_toggle_terminal", () => currentHandlers.current.onToggleTerminal()),
    listen("menu_toggle_ai_chat", () => currentHandlers.current.onToggleAiChat()),
    listen("menu_split_editor", () => currentHandlers.current.onSplitEditor()),
    listen("menu_toggle_vim", () => currentHandlers.current.onToggleVim()),
    listen("menu_go_to_file", () => currentHandlers.current.onGoToFile()),
    listen("menu_go_to_line", () => currentHandlers.current.onGoToLine()),
    listen("menu_next_tab", () => currentHandlers.current.onNextTab()),
    listen("menu_prev_tab", () => currentHandlers.current.onPrevTab()),
    listen("menu_theme_change", (event) => {
      currentHandlers.current.onThemeChange(event.payload as string);
    }),
    listen("menu_about", () => {
      currentHandlers.current.onAbout();
    }),
    listen("menu_help", () => currentHandlers.current.onHelp()),
    listen("menu_about_athas", () => currentHandlers.current.onAboutAthas()),
    listen("menu_toggle_menu_bar", () => currentHandlers.current.onToggleMenuBar()),
  ]);

  cleanupFunctions = removeListeners;

  window.addEventListener("beforeunload", cleanupMenuListeners);
}

interface UseMenuEventsProps {
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
  onGoToFile: () => void;
  onGoToLine: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
  onThemeChange: (theme: string) => void;
  onAbout: () => void;
  onHelp: () => void;
  onAboutAthas: () => void;
  onToggleMenuBar: () => void;
}

export function useMenuEvents(props: UseMenuEventsProps) {
  const handlersRef = useRef(props);

  handlersRef.current = props;

  useEffect(() => {
    setupMenuListeners(handlersRef);

    return () => {};
  }, []);
}
