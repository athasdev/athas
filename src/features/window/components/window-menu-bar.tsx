import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { exit } from "@tauri-apps/plugin-process";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRegisteredThemes } from "@/extensions/themes/use-registered-themes";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/ui/menubar";
import { cn } from "@/utils/cn";
import { IS_LINUX, IS_WINDOWS } from "@/utils/platform";

interface Props {
  activeMenu: string | null;
  setActiveMenu: React.Dispatch<React.SetStateAction<string | null>>;
  compactFloating?: boolean;
}

const WindowMenuBar = ({ activeMenu, setActiveMenu, compactFloating = false }: Props) => {
  const compactMenuBar = useSettingsStore((state) => state.settings.compactMenuBar);
  const themes = useRegisteredThemes();
  const menuWindowRaiseRef = useRef<{ restoreTo: boolean } | null>(null);
  const shouldRaiseWindowForMenu = (IS_WINDOWS || IS_LINUX) && Boolean(activeMenu);

  useEffect(() => {
    let disposed = false;
    const window = getCurrentWindow();

    const restoreWindowLevel = async () => {
      const previous = menuWindowRaiseRef.current;
      if (!previous) return;

      menuWindowRaiseRef.current = null;

      try {
        await window.setAlwaysOnTop(previous.restoreTo);
      } catch (error) {
        console.error("Failed to restore window menu level:", error);
      }
    };

    if (!shouldRaiseWindowForMenu) {
      void restoreWindowLevel();
      return;
    }

    if (menuWindowRaiseRef.current) {
      return;
    }

    void (async () => {
      try {
        const wasAlwaysOnTop = await window.isAlwaysOnTop();

        if (!wasAlwaysOnTop) {
          await window.setAlwaysOnTop(true);
        }

        if (disposed) {
          if (!wasAlwaysOnTop) {
            await window.setAlwaysOnTop(false);
          }
          return;
        }

        menuWindowRaiseRef.current = { restoreTo: wasAlwaysOnTop };
      } catch (error) {
        console.error("Failed to raise window menu level:", error);
      }
    })();

    return () => {
      disposed = true;
      void restoreWindowLevel();
    };
  }, [shouldRaiseWindowForMenu]);

  const handleClickEmit = useCallback(
    (event: string, payload?: unknown) => {
      const currentWindow = getCurrentWebviewWindow();
      void currentWindow.emitTo(currentWindow.label, event, payload);
      setActiveMenu(null);
    },
    [setActiveMenu],
  );

  const handleOpenWebInspector = useCallback(() => {
    void invoke("reopen_current_webview_devtools");
    setActiveMenu(null);
  }, [setActiveMenu]);

  const handleCommand = useCallback(
    (commandId: string) => {
      handleClickEmit("menu_execute_command", commandId);
    },
    [handleClickEmit],
  );

  const menus = useMemo(
    () => ({
      File: (
        <MenubarContent>
          <MenubarItem shortcut="mod+n" onClick={() => handleCommand("workbench.newTab")}>
            New Tab
          </MenubarItem>
          <MenubarItem shortcut="mod+shift+n" onClick={() => handleClickEmit("menu_new_window")}>
            New Window
          </MenubarItem>
          <MenubarItem onClick={() => handleClickEmit("menu_new_file")}>New File</MenubarItem>
          <MenubarItem shortcut="mod+o" onClick={() => handleClickEmit("menu_open_folder")}>
            Open Folder
          </MenubarItem>
          <MenubarItem onClick={() => handleClickEmit("menu_close_folder")}>
            Close Folder
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+s" onClick={() => handleClickEmit("menu_save")}>
            Save
          </MenubarItem>
          <MenubarItem shortcut="mod+shift+s" onClick={() => handleClickEmit("menu_save_as")}>
            Save As...
          </MenubarItem>
          <MenubarItem shortcut="mod+alt+s" onClick={() => handleCommand("file.saveAll")}>
            Save All
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("file.revert")}>Revert File</MenubarItem>
          <MenubarItem onClick={() => handleCommand("file.localHistory")}>
            Show Local History
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+w" onClick={() => handleClickEmit("menu_close_tab")}>
            Close Tab
          </MenubarItem>
          <MenubarItem
            shortcut="mod+shift+w"
            onClick={() => handleCommand("workbench.closeWindow")}
          >
            Close Window
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("file.closeAll")}>Close All Tabs</MenubarItem>
          <MenubarItem onClick={() => handleCommand("file.closeOthers")}>
            Close Other Tabs
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("file.closeSaved")}>
            Close Saved Tabs
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("file.closeTabsToLeft")}>
            Close Tabs to the Left
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("file.closeTabsToRight")}>
            Close Tabs to the Right
          </MenubarItem>
          <MenubarItem shortcut="mod+shift+t" onClick={() => handleCommand("file.reopenClosed")}>
            Reopen Closed Tab
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+q" onClick={async () => await exit(0)}>
            Quit
          </MenubarItem>
        </MenubarContent>
      ),
      Edit: (
        <MenubarContent>
          <MenubarItem shortcut="mod+z" onClick={() => handleClickEmit("menu_undo")}>
            Undo
          </MenubarItem>
          <MenubarItem shortcut="mod+shift+z" onClick={() => handleClickEmit("menu_redo")}>
            Redo
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+x" onClick={() => handleCommand("editor.cut")}>
            Cut
          </MenubarItem>
          <MenubarItem shortcut="mod+c" onClick={() => handleCommand("editor.copy")}>
            Copy
          </MenubarItem>
          <MenubarItem shortcut="mod+v" onClick={() => handleCommand("editor.paste")}>
            Paste
          </MenubarItem>
          <MenubarItem shortcut="mod+a" onClick={() => handleCommand("editor.selectAll")}>
            Select All
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+f" onClick={() => handleClickEmit("menu_find")}>
            Find
          </MenubarItem>
          <MenubarItem shortcut="mod+alt+f" onClick={() => handleClickEmit("menu_find_replace")}>
            Find and Replace
          </MenubarItem>
          <MenubarItem shortcut="mod+/" onClick={() => handleClickEmit("menu_toggle_comment")}>
            Toggle Comment
          </MenubarItem>
          <MenubarItem shortcut="mod+." onClick={() => handleCommand("editor.quickFix")}>
            Quick Fix
          </MenubarItem>
          <MenubarItem
            shortcut="mod+shift+space"
            onClick={() => handleCommand("editor.triggerParameterHints")}
          >
            Trigger Parameter Hints
          </MenubarItem>
          <MenubarItem shortcut="mod+k mod+i" onClick={() => handleCommand("editor.showHover")}>
            Show Hover
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+d" onClick={() => handleCommand("editor.duplicateLine")}>
            Duplicate Line
          </MenubarItem>
          <MenubarItem shortcut="mod+shift+k" onClick={() => handleCommand("editor.deleteLine")}>
            Delete Line
          </MenubarItem>
          <MenubarItem shortcut="alt+up" onClick={() => handleCommand("editor.moveLineUp")}>
            Move Line Up
          </MenubarItem>
          <MenubarItem shortcut="alt+down" onClick={() => handleCommand("editor.moveLineDown")}>
            Move Line Down
          </MenubarItem>
          <MenubarItem
            shortcut="shift+alt+f"
            onClick={() => handleCommand("editor.formatDocument")}
          >
            Format Document
          </MenubarItem>
          <MenubarItem
            shortcut="mod+k mod+f"
            onClick={() => handleCommand("editor.formatSelection")}
          >
            Format Selection
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            shortcut="mod+shift+p"
            onClick={() => handleClickEmit("menu_command_palette")}
          >
            Command Palette
          </MenubarItem>
        </MenubarContent>
      ),
      View: (
        <MenubarContent>
          <MenubarItem shortcut="mod+b" onClick={() => handleClickEmit("menu_toggle_sidebar")}>
            Toggle Sidebar
          </MenubarItem>
          <MenubarItem shortcut="mod+j" onClick={() => handleClickEmit("menu_toggle_terminal")}>
            Toggle Terminal
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            shortcut="mod+shift+f"
            onClick={() => handleCommand("workbench.showGlobalSearch")}
          >
            Global Search
          </MenubarItem>
          <MenubarItem
            shortcut="mod+shift+j"
            onClick={() => handleCommand("workbench.toggleDiagnostics")}
          >
            Diagnostics
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            shortcut="mod+shift+e"
            onClick={() => handleCommand("workbench.showFileExplorer")}
          >
            File Explorer
          </MenubarItem>
          <MenubarItem
            shortcut="mod+shift+g"
            onClick={() => handleCommand("workbench.showSourceControl")}
          >
            Source Control
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("workbench.showGitHub")}>GitHub</MenubarItem>
          <MenubarItem onClick={() => handleCommand("workbench.showDebugger")}>
            Run and Debug
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleClickEmit("menu_split_editor")}>
            Split Editor
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("workbench.toggleMinimap")}>
            Toggle Minimap
          </MenubarItem>
          <MenubarItem shortcut="alt+z" onClick={() => handleCommand("editor.toggleWordWrap")}>
            Toggle Word Wrap
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("editor.toggleLineNumbers")}>
            Toggle Line Numbers
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("editor.toggleRenderWhitespace")}>
            Toggle Render Whitespace
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+=" onClick={() => handleCommand("workbench.zoomIn")}>
            Zoom In
          </MenubarItem>
          <MenubarItem shortcut="mod+-" onClick={() => handleCommand("workbench.zoomOut")}>
            Zoom Out
          </MenubarItem>
          <MenubarItem shortcut="mod+0" onClick={() => handleCommand("workbench.zoomReset")}>
            Reset Zoom
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Theme</MenubarSubTrigger>
            <MenubarSubContent>
              {themes.map((theme) => (
                <MenubarItem
                  key={theme.id}
                  onClick={() => handleClickEmit("menu_theme_change", theme.id)}
                >
                  {theme.name}
                </MenubarItem>
              ))}
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      ),
      Go: (
        <MenubarContent>
          <MenubarItem shortcut="mod+p" onClick={() => handleClickEmit("menu_quick_open")}>
            Quick Open
          </MenubarItem>
          <MenubarItem shortcut="mod+g" onClick={() => handleClickEmit("menu_go_to_line")}>
            Go to Line
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="ctrl+-" onClick={() => handleCommand("navigation.goBack")}>
            Go Back
          </MenubarItem>
          <MenubarItem
            shortcut="ctrl+shift+-"
            onClick={() => handleCommand("navigation.goForward")}
          >
            Go Forward
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="f12" onClick={() => handleCommand("editor.goToDefinition")}>
            Go to Definition
          </MenubarItem>
          <MenubarItem
            shortcut="mod+f12"
            onClick={() => handleCommand("editor.goToImplementation")}
          >
            Go to Implementation
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("editor.goToTypeDefinition")}>
            Go to Type Definition
          </MenubarItem>
          <MenubarItem shortcut="shift+f12" onClick={() => handleCommand("editor.goToReferences")}>
            Go to References
          </MenubarItem>
          <MenubarItem shortcut="f2" onClick={() => handleCommand("editor.renameSymbol")}>
            Rename Symbol
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+alt+right" onClick={() => handleClickEmit("menu_next_tab")}>
            Next Tab
          </MenubarItem>
          <MenubarItem shortcut="mod+alt+left" onClick={() => handleClickEmit("menu_prev_tab")}>
            Previous Tab
          </MenubarItem>
        </MenubarContent>
      ),
      Terminal: (
        <MenubarContent>
          <MenubarItem onClick={() => handleCommand("terminal.new")}>New Terminal</MenubarItem>
          <MenubarItem onClick={() => handleCommand("terminal.split")}>Split Terminal</MenubarItem>
          <MenubarItem onClick={() => handleCommand("terminal.close")}>Close Terminal</MenubarItem>
        </MenubarContent>
      ),
      Run: (
        <MenubarContent>
          <MenubarItem shortcut="f5" onClick={() => handleCommand("debug.start")}>
            Start Debugging
          </MenubarItem>
          <MenubarItem shortcut="shift+f5" onClick={() => handleCommand("debug.stop")}>
            Stop Debugging
          </MenubarItem>
          <MenubarItem shortcut="f9" onClick={() => handleCommand("debug.toggleBreakpoint")}>
            Toggle Breakpoint
          </MenubarItem>
        </MenubarContent>
      ),
      Agent: (
        <MenubarContent>
          <MenubarItem shortcut="mod+r" onClick={() => handleClickEmit("menu_toggle_ai_chat")}>
            Toggle Agent
          </MenubarItem>
          <MenubarItem
            shortcut="mod+shift+space"
            onClick={() => handleCommand("workbench.agentLauncher")}
          >
            New Agent
          </MenubarItem>
          <MenubarItem shortcut="mod+i" onClick={() => handleCommand("editor.inlineEdit")}>
            Inline Edit
          </MenubarItem>
        </MenubarContent>
      ),
      Tools: (
        <MenubarContent>
          <MenubarItem onClick={() => handleCommand("database.connect")}>Databases</MenubarItem>
          <MenubarSeparator />
          <MenubarItem shortcut="mod+alt+i" onClick={handleOpenWebInspector}>
            Web Inspector
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleClickEmit("menu_open_settings")}>
            Preferences
          </MenubarItem>
          <MenubarItem onClick={() => handleClickEmit("menu_open_extensions")}>
            Extensions
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("workbench.openKeyboardShortcuts")}>
            Keyboard Shortcuts
          </MenubarItem>
        </MenubarContent>
      ),
      Window: (
        <MenubarContent>
          <MenubarItem
            shortcut="alt+f9"
            onClick={async () => {
              await getCurrentWindow().minimize();
              setActiveMenu(null);
            }}
          >
            Minimize
          </MenubarItem>
          <MenubarItem
            shortcut="alt+f10"
            onClick={async () => {
              await getCurrentWindow().maximize();
              setActiveMenu(null);
            }}
          >
            Maximize
          </MenubarItem>
          {!IS_LINUX && (
            <>
              <MenubarSeparator />
              <MenubarItem shortcut="alt+m" onClick={() => handleClickEmit("menu_toggle_menu_bar")}>
                Toggle Menu Bar
              </MenubarItem>
              <MenubarSeparator />
            </>
          )}
          <MenubarItem
            shortcut="f11"
            onClick={async () => {
              const window = getCurrentWindow();
              const isFull = await window.isFullscreen();
              await window.setFullscreen(!isFull);
              setActiveMenu(null);
            }}
          >
            Toggle Fullscreen
          </MenubarItem>
        </MenubarContent>
      ),
      Help: (
        <MenubarContent>
          <MenubarItem onClick={() => handleClickEmit("menu_documentation")}>
            Documentation
          </MenubarItem>
          <MenubarItem onClick={() => handleCommand("workbench.openKeyboardShortcuts")}>
            Keyboard Shortcuts
          </MenubarItem>
          <MenubarItem onClick={() => handleClickEmit("menu_whats_new")}>What's New</MenubarItem>
          <MenubarItem onClick={() => handleClickEmit("menu_changelog")}>Changelog</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleClickEmit("menu_report_bug")}>Report a Bug</MenubarItem>
          <MenubarItem onClick={() => handleClickEmit("menu_request_feature")}>
            Request a Feature
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={() => handleClickEmit("menu_check_updates")}>
            Check for Updates
          </MenubarItem>
        </MenubarContent>
      ),
    }),
    [handleClickEmit, handleCommand, setActiveMenu, themes],
  );

  if (compactMenuBar && !activeMenu) return null;

  return (
    <div
      className={cn(
        "z-[10030] flex flex-col",
        compactMenuBar && compactFloating && "absolute top-full left-0 mt-1",
        compactMenuBar && !compactFloating && "absolute inset-0",
      )}
    >
      <Menubar
        value={activeMenu ?? ""}
        onValueChange={(value) => setActiveMenu(value || null)}
        className={cn(
          compactMenuBar &&
            compactFloating &&
            "rounded-2xl border border-border bg-primary-bg/95 px-1 py-1 shadow-[var(--shadow-popover)] backdrop-blur-sm",
          compactMenuBar &&
            !compactFloating &&
            "h-full rounded-none border-none bg-transparent px-2 py-0",
        )}
      >
        {Object.entries(menus).map(([menuName, menuContent]) => (
          <MenubarMenu key={menuName} value={menuName}>
            <MenubarTrigger>{menuName}</MenubarTrigger>
            {menuContent}
          </MenubarMenu>
        ))}
      </Menubar>
    </div>
  );
};

export default WindowMenuBar;
