import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { exit } from "@tauri-apps/plugin-process";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/types";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import Menu from "./menu";
import MenuItem from "./menu-item";
import Submenu from "./submenu";

interface Props {
  activeMenu: string | null;
  setActiveMenu: React.Dispatch<React.SetStateAction<string | null>>;
  compactFloating?: boolean;
  anchorRef?: React.RefObject<HTMLButtonElement | null>;
}

const CustomMenuBar = ({
  activeMenu,
  setActiveMenu,
  compactFloating = false,
  anchorRef,
}: Props) => {
  const { settings } = useSettingsStore();
  const [themes, setThemes] = useState<ThemeDefinition[]>([]);
  const menuBarRef = useRef<HTMLDivElement>(null);

  const handleClickEmit = (event: string, payload?: unknown) => {
    void getCurrentWebviewWindow().emit(event, payload);
    setActiveMenu(null);
  };

  const handleOpenWebInspector = () => {
    void invoke("reopen_current_webview_devtools");
    setActiveMenu(null);
  };

  const handleCommand = (commandId: string) => {
    handleClickEmit("menu_execute_command", commandId);
  };

  useEffect(() => {
    const loadThemes = () => {
      const registryThemes = themeRegistry.getAllThemes();
      setThemes(registryThemes);
    };

    loadThemes();

    const unsubscribe = themeRegistry.onRegistryChange(loadThemes);
    return unsubscribe;
  }, []);

  const menus = useMemo(
    () => ({
      File: (
        <Menu aria-label="File">
          <MenuItem shortcut="mod+n" onClick={() => handleCommand("workbench.newTab")}>
            New Tab
          </MenuItem>
          <MenuItem shortcut="mod+shift+n" onClick={() => handleClickEmit("menu_new_window")}>
            New Window
          </MenuItem>
          <MenuItem onClick={() => handleClickEmit("menu_new_file")}>New File</MenuItem>
          <MenuItem shortcut="mod+o" onClick={() => handleClickEmit("menu_open_folder")}>
            Open Folder
          </MenuItem>
          <MenuItem onClick={() => handleClickEmit("menu_close_folder")}>Close Folder</MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+s" onClick={() => handleClickEmit("menu_save")}>
            Save
          </MenuItem>
          <MenuItem shortcut="mod+shift+s" onClick={() => handleClickEmit("menu_save_as")}>
            Save As...
          </MenuItem>
          <MenuItem shortcut="mod+alt+s" onClick={() => handleCommand("file.saveAll")}>
            Save All
          </MenuItem>
          <MenuItem onClick={() => handleCommand("file.revert")}>Revert File</MenuItem>
          <MenuItem onClick={() => handleCommand("file.localHistory")}>Show Local History</MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+w" onClick={() => handleClickEmit("menu_close_tab")}>
            Close Tab
          </MenuItem>
          <MenuItem onClick={() => handleCommand("file.closeAll")}>Close All Tabs</MenuItem>
          <MenuItem onClick={() => handleCommand("file.closeOthers")}>Close Other Tabs</MenuItem>
          <MenuItem onClick={() => handleCommand("file.closeSaved")}>Close Saved Tabs</MenuItem>
          <MenuItem onClick={() => handleCommand("file.closeTabsToLeft")}>
            Close Tabs to the Left
          </MenuItem>
          <MenuItem onClick={() => handleCommand("file.closeTabsToRight")}>
            Close Tabs to the Right
          </MenuItem>
          <MenuItem shortcut="mod+shift+t" onClick={() => handleCommand("file.reopenClosed")}>
            Reopen Closed Tab
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+q" onClick={async () => await exit(0)}>
            Quit
          </MenuItem>
        </Menu>
      ),
      Edit: (
        <Menu aria-label="Edit">
          <MenuItem shortcut="mod+z" onClick={() => handleClickEmit("menu_undo")}>
            Undo
          </MenuItem>
          <MenuItem shortcut="mod+shift+z" onClick={() => handleClickEmit("menu_redo")}>
            Redo
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+x" onClick={() => handleCommand("editor.cut")}>
            Cut
          </MenuItem>
          <MenuItem shortcut="mod+c" onClick={() => handleCommand("editor.copy")}>
            Copy
          </MenuItem>
          <MenuItem shortcut="mod+v" onClick={() => handleCommand("editor.paste")}>
            Paste
          </MenuItem>
          <MenuItem shortcut="mod+a" onClick={() => handleCommand("editor.selectAll")}>
            Select All
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+f" onClick={() => handleClickEmit("menu_find")}>
            Find
          </MenuItem>
          <MenuItem shortcut="mod+alt+f" onClick={() => handleClickEmit("menu_find_replace")}>
            Find and Replace
          </MenuItem>
          <MenuItem shortcut="mod+/" onClick={() => handleClickEmit("menu_toggle_comment")}>
            Toggle Comment
          </MenuItem>
          <MenuItem shortcut="mod+." onClick={() => handleCommand("editor.quickFix")}>
            Quick Fix
          </MenuItem>
          <MenuItem
            shortcut="mod+shift+space"
            onClick={() => handleCommand("editor.triggerParameterHints")}
          >
            Trigger Parameter Hints
          </MenuItem>
          <MenuItem shortcut="mod+k mod+i" onClick={() => handleCommand("editor.showHover")}>
            Show Hover
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+d" onClick={() => handleCommand("editor.duplicateLine")}>
            Duplicate Line
          </MenuItem>
          <MenuItem shortcut="mod+shift+k" onClick={() => handleCommand("editor.deleteLine")}>
            Delete Line
          </MenuItem>
          <MenuItem shortcut="alt+up" onClick={() => handleCommand("editor.moveLineUp")}>
            Move Line Up
          </MenuItem>
          <MenuItem shortcut="alt+down" onClick={() => handleCommand("editor.moveLineDown")}>
            Move Line Down
          </MenuItem>
          <MenuItem shortcut="shift+alt+f" onClick={() => handleCommand("editor.formatDocument")}>
            Format Document
          </MenuItem>
          <MenuItem shortcut="mod+k mod+f" onClick={() => handleCommand("editor.formatSelection")}>
            Format Selection
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+shift+p" onClick={() => handleClickEmit("menu_command_palette")}>
            Command Palette
          </MenuItem>
        </Menu>
      ),
      View: (
        <Menu aria-label="View">
          <MenuItem shortcut="mod+b" onClick={() => handleClickEmit("menu_toggle_sidebar")}>
            Toggle Sidebar
          </MenuItem>
          <MenuItem shortcut="mod+j" onClick={() => handleClickEmit("menu_toggle_terminal")}>
            Toggle Terminal
          </MenuItem>
          <MenuItem separator />
          <MenuItem
            shortcut="mod+shift+f"
            onClick={() => handleCommand("workbench.showGlobalSearch")}
          >
            Global Search
          </MenuItem>
          <MenuItem
            shortcut="mod+shift+j"
            onClick={() => handleCommand("workbench.toggleDiagnostics")}
          >
            Diagnostics
          </MenuItem>
          <MenuItem separator />
          <MenuItem
            shortcut="mod+shift+e"
            onClick={() => handleCommand("workbench.showFileExplorer")}
          >
            File Explorer
          </MenuItem>
          <MenuItem
            shortcut="mod+shift+g"
            onClick={() => handleCommand("workbench.showSourceControl")}
          >
            Source Control
          </MenuItem>
          <MenuItem onClick={() => handleCommand("workbench.showGitHub")}>GitHub</MenuItem>
          <MenuItem onClick={() => handleCommand("workbench.showDebugger")}>Run and Debug</MenuItem>
          <MenuItem separator />
          <MenuItem onClick={() => handleClickEmit("menu_split_editor")}>Split Editor</MenuItem>
          <MenuItem onClick={() => handleCommand("workbench.toggleMinimap")}>
            Toggle Minimap
          </MenuItem>
          <MenuItem shortcut="alt+z" onClick={() => handleCommand("editor.toggleWordWrap")}>
            Toggle Word Wrap
          </MenuItem>
          <MenuItem onClick={() => handleCommand("editor.toggleLineNumbers")}>
            Toggle Line Numbers
          </MenuItem>
          <MenuItem onClick={() => handleCommand("editor.toggleRenderWhitespace")}>
            Toggle Render Whitespace
          </MenuItem>
          <MenuItem onClick={() => handleCommand("workbench.toggleSidebarPosition")}>
            Toggle Sidebar Position
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+=" onClick={() => handleCommand("workbench.zoomIn")}>
            Zoom In
          </MenuItem>
          <MenuItem shortcut="mod+-" onClick={() => handleCommand("workbench.zoomOut")}>
            Zoom Out
          </MenuItem>
          <MenuItem shortcut="mod+0" onClick={() => handleCommand("workbench.zoomReset")}>
            Reset Zoom
          </MenuItem>
          <MenuItem separator />
          <Submenu title="Theme">
            {themes.map((theme) => (
              <MenuItem
                key={theme.id}
                onClick={() => handleClickEmit("menu_theme_change", theme.id)}
              >
                {theme.name}
              </MenuItem>
            ))}
          </Submenu>
        </Menu>
      ),
      Go: (
        <Menu aria-label="Go">
          <MenuItem shortcut="mod+p" onClick={() => handleClickEmit("menu_quick_open")}>
            Quick Open
          </MenuItem>
          <MenuItem shortcut="mod+g" onClick={() => handleClickEmit("menu_go_to_line")}>
            Go to Line
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="ctrl+-" onClick={() => handleCommand("navigation.goBack")}>
            Go Back
          </MenuItem>
          <MenuItem shortcut="ctrl+shift+-" onClick={() => handleCommand("navigation.goForward")}>
            Go Forward
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="f12" onClick={() => handleCommand("editor.goToDefinition")}>
            Go to Definition
          </MenuItem>
          <MenuItem shortcut="mod+f12" onClick={() => handleCommand("editor.goToImplementation")}>
            Go to Implementation
          </MenuItem>
          <MenuItem onClick={() => handleCommand("editor.goToTypeDefinition")}>
            Go to Type Definition
          </MenuItem>
          <MenuItem shortcut="shift+f12" onClick={() => handleCommand("editor.goToReferences")}>
            Go to References
          </MenuItem>
          <MenuItem shortcut="f2" onClick={() => handleCommand("editor.renameSymbol")}>
            Rename Symbol
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+alt+right" onClick={() => handleClickEmit("menu_next_tab")}>
            Next Tab
          </MenuItem>
          <MenuItem shortcut="mod+alt+left" onClick={() => handleClickEmit("menu_prev_tab")}>
            Previous Tab
          </MenuItem>
        </Menu>
      ),
      Terminal: (
        <Menu aria-label="Terminal">
          <MenuItem onClick={() => handleCommand("terminal.new")}>New Terminal</MenuItem>
          <MenuItem onClick={() => handleCommand("terminal.split")}>Split Terminal</MenuItem>
          <MenuItem onClick={() => handleCommand("terminal.close")}>Close Terminal</MenuItem>
        </Menu>
      ),
      Run: (
        <Menu aria-label="Run">
          <MenuItem shortcut="f5" onClick={() => handleCommand("debug.start")}>
            Start Debugging
          </MenuItem>
          <MenuItem shortcut="shift+f5" onClick={() => handleCommand("debug.stop")}>
            Stop Debugging
          </MenuItem>
          <MenuItem shortcut="f9" onClick={() => handleCommand("debug.toggleBreakpoint")}>
            Toggle Breakpoint
          </MenuItem>
        </Menu>
      ),
      AI: (
        <Menu aria-label="AI">
          <MenuItem shortcut="mod+r" onClick={() => handleClickEmit("menu_toggle_ai_chat")}>
            Toggle AI Chat
          </MenuItem>
          <MenuItem
            shortcut="mod+shift+space"
            onClick={() => handleCommand("workbench.agentLauncher")}
          >
            New Agent
          </MenuItem>
          <MenuItem shortcut="mod+i" onClick={() => handleCommand("editor.inlineEdit")}>
            Inline Edit
          </MenuItem>
        </Menu>
      ),
      Tools: (
        <Menu aria-label="Tools">
          <MenuItem onClick={() => handleCommand("database.connect")}>Databases</MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="mod+alt+i" onClick={handleOpenWebInspector}>
            Web Inspector
          </MenuItem>
          <MenuItem separator />
          <MenuItem onClick={() => handleClickEmit("menu_open_settings")}>Preferences</MenuItem>
          <MenuItem onClick={() => handleClickEmit("menu_open_extensions")}>Extensions</MenuItem>
          <MenuItem onClick={() => handleCommand("workbench.openKeyboardShortcuts")}>
            Keyboard Shortcuts
          </MenuItem>
        </Menu>
      ),
      Window: (
        <Menu aria-label="Window">
          <MenuItem
            shortcut="alt+f9"
            onClick={async () => {
              await getCurrentWindow().minimize();
              setActiveMenu(null);
            }}
          >
            Minimize
          </MenuItem>
          <MenuItem
            shortcut="alt+f10"
            onClick={async () => {
              await getCurrentWindow().maximize();
              setActiveMenu(null);
            }}
          >
            Maximize
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="alt+m" onClick={() => handleClickEmit("menu_toggle_menu_bar")}>
            Toggle Menu Bar
          </MenuItem>
          <MenuItem separator />
          <MenuItem
            shortcut="f11"
            onClick={async () => {
              const window = getCurrentWindow();
              const isFull = await window.isFullscreen();
              await window.setFullscreen(!isFull);
              setActiveMenu(null);
            }}
          >
            Toggle Fullscreen
          </MenuItem>
        </Menu>
      ),
      Help: (
        <Menu aria-label="Help">
          <MenuItem onClick={() => handleClickEmit("menu_documentation")}>Documentation</MenuItem>
          <MenuItem onClick={() => handleCommand("workbench.openKeyboardShortcuts")}>
            Keyboard Shortcuts
          </MenuItem>
          <MenuItem onClick={() => handleClickEmit("menu_whats_new")}>What's New</MenuItem>
          <MenuItem onClick={() => handleClickEmit("menu_changelog")}>Changelog</MenuItem>
          <MenuItem separator />
          <MenuItem onClick={() => handleClickEmit("menu_report_bug")}>Report a Bug</MenuItem>
          <MenuItem onClick={() => handleClickEmit("menu_request_feature")}>
            Request a Feature
          </MenuItem>
          <MenuItem separator />
          <MenuItem onClick={() => handleClickEmit("menu_check_updates")}>
            Check for Updates
          </MenuItem>
        </Menu>
      ),
    }),
    [handleClickEmit, handleCommand, setActiveMenu, themes],
  );

  useEffect(() => {
    if (!activeMenu) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideMenuBar = menuBarRef.current?.contains(target);
      const isAnchorButton = anchorRef?.current?.contains(target);
      if (!isInsideMenuBar && !isAnchorButton) {
        setActiveMenu(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [activeMenu, setActiveMenu, anchorRef]);

  // In compact mode, hide entirely when no menu is open
  if (settings.compactMenuBar && !activeMenu) return null;

  return (
    <div
      ref={menuBarRef}
      className={cn(
        "z-[10030] flex flex-col",
        settings.compactMenuBar && compactFloating && "absolute top-full left-0 mt-1",
        settings.compactMenuBar && !compactFloating && "absolute inset-0",
      )}
    >
      {/* Horizontal tab bar */}
      <div
        className={cn(
          "flex h-6 items-center gap-0.5 rounded-full border border-border/70 bg-primary-bg/65 px-0.5 py-0.5",
          settings.compactMenuBar &&
            compactFloating &&
            "rounded-2xl border border-border bg-primary-bg/95 px-1 py-1 shadow-xl backdrop-blur-sm",
          settings.compactMenuBar &&
            !compactFloating &&
            "h-full rounded-none border-none bg-transparent px-2 py-0",
        )}
      >
        {Object.keys(menus).map((menuName) => (
          <Button
            key={menuName}
            variant="ghost"
            className={cn(
              "ui-text-sm h-5 rounded-md px-1.5 text-text-lighter",
              activeMenu === menuName
                ? "bg-hover/80 text-text"
                : "hover:bg-hover/50 hover:text-text",
            )}
            onClick={() => setActiveMenu((current) => (current === menuName ? null : menuName))}
          >
            {menuName}
          </Button>
        ))}
      </div>

      {/* Dropdown — rendered below the tab bar, not overlapping it */}
      {activeMenu && (
        <div className="z-[10031] mt-1 w-max min-w-[180px]">
          {menus[activeMenu as keyof typeof menus]}
        </div>
      )}
    </div>
  );
};

export default CustomMenuBar;
