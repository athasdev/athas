import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, type RefObject } from "react";
import { listenToMenuActions } from "../services/menu-actions";

type Handlers = RefObject<UseMenuEventsProps>;

/** Menu action ids, as Rust and the in-window menu bar send them, mapped to their handlers. */
const MENU_ACTION_HANDLERS: Record<
  string,
  (handlers: UseMenuEventsProps, value: string) => unknown
> = {
  new_window: (h) => h.onNewWindow(),
  new_file: (h) => h.onNewFile(),
  open_folder: (h) => h.onOpenFolder(),
  close_folder: (h) => h.onCloseFolder(),
  save: (h) => h.onSave(),
  save_as: (h) => h.onSaveAs(),
  close_tab: (h) => h.onCloseTab(),
  undo: (h) => h.onUndo(),
  redo: (h) => h.onRedo(),
  select_all: (h) => h.onSelectAll(),
  find: (h) => h.onFind(),
  find_replace: (h) => h.onFindReplace(),
  toggle_comment: (h) => h.onToggleComment(),
  command_palette: (h) => h.onCommandPalette(),
  toggle_sidebar: (h) => h.onToggleSidebar(),
  toggle_terminal: (h) => h.onToggleTerminal(),
  split_editor: (h) => h.onSplitEditor(),
  toggle_vim: (h) => h.onToggleVim(),
  quick_open: (h) => h.onQuickOpen(),
  next_tab: (h) => h.onNextTab(),
  prev_tab: (h) => h.onPrevTab(),
  theme_change: (h, value) => h.onThemeChange(value),
  execute_command: (h, value) => h.onExecuteCommand(value),
  documentation: (h) => h.onDocumentation(),
  changelog: (h) => h.onChangelog(),
  whats_new: (h) => h.onWhatsNew(),
  report_bug: (h) => h.onReportBug(),
  request_feature: (h) => h.onRequestFeature(),
  check_updates: (h) => h.onCheckForUpdates(),
  open_github_notifications: (h) => h.onOpenGitHubNotifications(),
  open_settings: (h) => h.onOpenSettings(),
  open_extensions: (h) => h.onOpenExtensions(),
  toggle_menu_bar: (h) => h.onToggleMenuBar(),
};

let listenersAreSetup = false;
let currentHandlers: Handlers | null = null;
let removeListener: UnlistenFn | null = null;

function cleanupMenuListeners() {
  if (!listenersAreSetup) return;
  removeListener?.();
  removeListener = null;
  listenersAreSetup = false;
  currentHandlers = null;
}

async function setupMenuListeners(handlers: Handlers) {
  currentHandlers = handlers;
  if (listenersAreSetup) return;
  listenersAreSetup = true;

  removeListener = await listenToMenuActions(({ action, value }) => {
    const handle = MENU_ACTION_HANDLERS[action];
    if (handle && currentHandlers) void handle(currentHandlers.current, value ?? "");
  });

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
  onSelectAll: () => void;
  onFind: () => void;
  onFindReplace: () => void;
  onToggleComment: () => void;
  onCommandPalette: () => void;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  onSplitEditor: () => void;
  onToggleVim: () => void;
  onQuickOpen: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
  onThemeChange: (theme: string) => void;
  onExecuteCommand: (commandId: string) => void | Promise<void>;
  onDocumentation: () => void | Promise<void>;
  onChangelog: () => void | Promise<void>;
  onWhatsNew: () => void | Promise<void>;
  onReportBug: () => void | Promise<void>;
  onRequestFeature: () => void | Promise<void>;
  onCheckForUpdates: () => void | Promise<void>;
  onOpenGitHubNotifications: () => void;
  onOpenSettings: () => void | Promise<void>;
  onOpenExtensions: () => void | Promise<void>;
  onToggleMenuBar: () => void;
}

export function useMenuEvents(props: UseMenuEventsProps) {
  const handlersRef = useRef(props);

  useEffect(() => {
    handlersRef.current = props;
  }, [props]);

  useEffect(() => {
    setupMenuListeners(handlersRef);

    return () => {
      cleanupMenuListeners();
      window.removeEventListener("beforeunload", cleanupMenuListeners);
    };
  }, []);
}
