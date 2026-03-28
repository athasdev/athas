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
}

const CustomMenuBar = ({ activeMenu, setActiveMenu, compactFloating = false }: Props) => {
  const { settings } = useSettingsStore();
  const [themes, setThemes] = useState<ThemeDefinition[]>([]);
  const menuBarRef = useRef<HTMLDivElement>(null);

  const handleClickEmit = (event: string, payload?: unknown) => {
    void getCurrentWebviewWindow().emit(event, payload);
    setActiveMenu(null);
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
          <MenuItem shortcut="Ctrl+Shift+N" onClick={() => handleClickEmit("menu_new_window")}>
            New Window
          </MenuItem>
          <MenuItem shortcut="Ctrl+N" onClick={() => handleClickEmit("menu_new_file")}>
            New File
          </MenuItem>
          <MenuItem shortcut="Ctrl+O" onClick={() => handleClickEmit("menu_open_folder")}>
            Open Folder
          </MenuItem>
          <MenuItem onClick={() => handleClickEmit("menu_close_folder")}>Close Folder</MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+S" onClick={() => handleClickEmit("menu_save")}>
            Save
          </MenuItem>
          <MenuItem shortcut="Ctrl+Shift+S" onClick={() => handleClickEmit("menu_save_as")}>
            Save As...
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+W" onClick={() => handleClickEmit("menu_close_tab")}>
            Close Tab
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+Q" onClick={async () => await exit(0)}>
            Quit
          </MenuItem>
        </Menu>
      ),
      Edit: (
        <Menu aria-label="Edit">
          <MenuItem shortcut="Ctrl+Z" onClick={() => handleClickEmit("menu_undo")}>
            Undo
          </MenuItem>
          <MenuItem shortcut="Ctrl+Shift+Z" onClick={() => handleClickEmit("menu_redo")}>
            Redo
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+X">Cut</MenuItem>
          <MenuItem shortcut="Ctrl+C">Copy</MenuItem>
          <MenuItem shortcut="Ctrl+V">Paste</MenuItem>
          <MenuItem shortcut="Ctrl+A">Select All</MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+F" onClick={() => handleClickEmit("menu_find")}>
            Find
          </MenuItem>
          <MenuItem shortcut="Ctrl+Alt+F" onClick={() => handleClickEmit("menu_find_replace")}>
            Find and Replace
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+Shift+P" onClick={() => handleClickEmit("menu_command_palette")}>
            Command Palette
          </MenuItem>
        </Menu>
      ),
      View: (
        <Menu aria-label="View">
          <MenuItem shortcut="Ctrl+B" onClick={() => handleClickEmit("menu_toggle_sidebar")}>
            Toggle Sidebar
          </MenuItem>
          <MenuItem shortcut="Ctrl+J" onClick={() => handleClickEmit("menu_toggle_terminal")}>
            Toggle Terminal
          </MenuItem>
          <MenuItem shortcut="Ctrl+R" onClick={() => handleClickEmit("menu_toggle_ai_chat")}>
            Toggle Harness
          </MenuItem>
          <MenuItem separator />
          <MenuItem onClick={() => handleClickEmit("menu_split_editor")}>Split Editor</MenuItem>
          <MenuItem separator />
          <MenuItem
            shortcut="Alt+M"
            onClick={() => setActiveMenu((value) => (value ? null : "File"))}
          >
            Toggle Menu Bar
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
          <MenuItem shortcut="Ctrl+P" onClick={() => handleClickEmit("menu_quick_open")}>
            Quick Open
          </MenuItem>
          <MenuItem shortcut="Ctrl+G" onClick={() => handleClickEmit("menu_go_to_line")}>
            Go to Line
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+Alt+Right" onClick={() => handleClickEmit("menu_next_tab")}>
            Next Tab
          </MenuItem>
          <MenuItem shortcut="Ctrl+Alt+Left" onClick={() => handleClickEmit("menu_prev_tab")}>
            Previous Tab
          </MenuItem>
        </Menu>
      ),
      Window: (
        <Menu aria-label="Window">
          <MenuItem
            shortcut="Alt+F9"
            onClick={async () => {
              await getCurrentWindow().minimize();
              setActiveMenu(null);
            }}
          >
            Minimize
          </MenuItem>
          <MenuItem
            shortcut="Alt+F10"
            onClick={async () => {
              await getCurrentWindow().maximize();
              setActiveMenu(null);
            }}
          >
            Maximize
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+Q" onClick={async () => await exit(0)}>
            Quit
          </MenuItem>
          <MenuItem separator />
          <MenuItem
            shortcut="F11"
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
          <MenuItem onClick={() => handleClickEmit("menu_help")}>Help</MenuItem>
          <MenuItem separator />
          <MenuItem onClick={() => handleClickEmit("menu_about_athas")}>About Athas</MenuItem>
        </Menu>
      ),
    }),
    [handleClickEmit, setActiveMenu, themes],
  );

  useEffect(() => {
    if (!activeMenu) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [activeMenu, setActiveMenu]);

  if (settings.compactMenuBar && !activeMenu) return null;

  return (
    <div
      ref={menuBarRef}
      className={cn(
        "z-[10030] flex h-6 items-center gap-0.5 rounded-full border border-border/70 bg-primary-bg/65 px-0.5 py-0.5",
        settings.compactMenuBar &&
          compactFloating &&
          "absolute top-[calc(100%+4px)] left-0 rounded-2xl border border-border bg-primary-bg/95 px-1 py-1 shadow-xl backdrop-blur-sm",
        settings.compactMenuBar &&
          !compactFloating &&
          "absolute inset-0 h-full rounded-none border-none bg-transparent px-2 py-0",
      )}
    >
      {Object.keys(menus).map((menuName) => (
        <Button
          key={menuName}
          variant="ghost"
          size="sm"
          className={cn(
            "ui-text-sm h-5 rounded-md px-1.5 text-text-lighter",
            activeMenu === menuName ? "bg-hover/80 text-text" : "hover:bg-hover/50 hover:text-text",
          )}
          onClick={() => setActiveMenu((current) => (current === menuName ? null : menuName))}
        >
          {menuName}
        </Button>
      ))}

      {activeMenu && menus[activeMenu as keyof typeof menus]}
    </div>
  );
};

export default CustomMenuBar;
