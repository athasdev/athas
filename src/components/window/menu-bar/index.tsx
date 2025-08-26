import { emit } from "@tauri-apps/api/event";
import type React from "react";
import { type JSX, useEffect, useMemo } from "react";

import Button from "@/components/ui/button";
import { useSettingsStore } from "@/settings/store";
import { cn } from "@/utils/cn";

import Menu from "./menu";
import MenuItem from "./menu-item";
import Submenu from "./submenu";

interface Props {
  activeMenu: string | null;
  setActiveMenu: React.Dispatch<React.SetStateAction<string | null>>;
}

const CustomMenuBar = ({ activeMenu, setActiveMenu }: Props) => {
  const { settings } = useSettingsStore();

  const handleClick = (event: string, payload?: unknown) => {
    emit(event, payload);
    setActiveMenu(null);
  };

  const menus = useMemo(
    () => ({
      File: (
        <Menu>
          <MenuItem shortcut="Ctrl+N" onClick={() => handleClick("menu_new_file")}>
            New File
          </MenuItem>
          <MenuItem shortcut="Ctrl+O" onClick={() => handleClick("menu_open_folder")}>
            Open Folder
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+S" onClick={() => handleClick("menu_save")}>
            Save
          </MenuItem>
          <MenuItem shortcut="Ctrl+Shift+S" onClick={() => handleClick("menu_save_as")}>
            Save As...
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+W" onClick={() => handleClick("menu_close_tab")}>
            Close Tab
          </MenuItem>
        </Menu>
      ),
      Edit: (
        <Menu>
          <MenuItem shortcut="Ctrl+Z" onClick={() => handleClick("menu_undo")}>
            Undo
          </MenuItem>
          <MenuItem shortcut="Ctrl+Shift+Z" onClick={() => handleClick("menu_redo")}>
            Redo
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="Ctrl+Shift+X">Cut</MenuItem>
          <MenuItem shortcut="Ctrl+C">Copy</MenuItem>
          <MenuItem shortcut="⌘V">Paste</MenuItem>
          <MenuItem shortcut="⌘A">Select All</MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="⌘F" onClick={() => handleClick("menu_find")}>
            Find
          </MenuItem>
          <MenuItem shortcut="⌥⌘F" onClick={() => handleClick("menu_find_replace")}>
            Find and Replace
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="⇧⌘P" onClick={() => handleClick("menu_command_palette")}>
            Command Palette
          </MenuItem>
        </Menu>
      ),
      View: (
        <Menu>
          <MenuItem shortcut="⌘B" onClick={() => handleClick("menu_toggle_sidebar")}>
            Toggle Sidebar
          </MenuItem>
          <MenuItem shortcut="⌘J" onClick={() => handleClick("menu_toggle_terminal")}>
            Toggle Terminal
          </MenuItem>
          <MenuItem shortcut="⌘R" onClick={() => handleClick("menu_toggle_ai_chat")}>
            Toggle AI Chat
          </MenuItem>
          <MenuItem separator />
          <MenuItem onClick={() => handleClick("menu_split_editor")}>Split Editor</MenuItem>
          <MenuItem separator />
          <Submenu title="Theme">
            <MenuItem onClick={() => handleClick("menu_theme_change", "auto")}>Auto</MenuItem>
            <MenuItem separator />
            <MenuItem onClick={() => handleClick("menu_theme_change", "light")}>Light</MenuItem>
            <MenuItem onClick={() => handleClick("menu_theme_change", "dark")}>Dark</MenuItem>
            <MenuItem onClick={() => handleClick("menu_theme_change", "midnight")}>
              Midnight
            </MenuItem>
            <MenuItem separator />
            <MenuItem onClick={() => handleClick("menu_theme_change", "catppuccin_mocha")}>
              Catppuccin Mocha
            </MenuItem>
            <MenuItem onClick={() => handleClick("menu_theme_change", "tokyo_night")}>
              Tokyo Night
            </MenuItem>
            <MenuItem onClick={() => handleClick("menu_theme_change", "dracula")}>Dracula</MenuItem>
            <MenuItem onClick={() => handleClick("menu_theme_change", "nord")}>Nord</MenuItem>
          </Submenu>
        </Menu>
      ),
      Go: (
        <Menu>
          <MenuItem shortcut="⌘P" onClick={() => handleClick("menu_go_to_file")}>
            Go to File
          </MenuItem>
          <MenuItem shortcut="⌘G" onClick={() => handleClick("menu_go_to_line")}>
            Go to Line
          </MenuItem>
          <MenuItem separator />
          <MenuItem shortcut="⌥⌘→" onClick={() => handleClick("menu_next_tab")}>
            Next Tab
          </MenuItem>
          <MenuItem shortcut="⌥⌘←" onClick={() => handleClick("menu_prev_tab")}>
            Previous Tab
          </MenuItem>
        </Menu>
      ),
      Help: (
        <Menu>
          <MenuItem onClick={() => handleClick("menu_help")}>Help</MenuItem>
        </Menu>
      ),
    }),
    [],
  );

  // Map through the menus object above and place all shortcuts and click events into an array
  const shortcuts = useMemo(() => {
    return Object.values(menus).flatMap((menu) => {
      const children = menu.props.children;
      if (!Array.isArray(children)) return [];

      return children
        .map((item: JSX.Element) => {
          const shortcut = item.props.shortcut;
          const onClick = item.props.onClick;

          if (!shortcut || !onClick) return null;
          return { shortcut, onClick };
        })
        .filter(Boolean) as { shortcut: string; onClick: () => void }[];
    });
  }, [menus]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if Ctrl is pressed (or Cmd on macOS)
      if (!(e.ctrlKey || e.metaKey)) return;

      // Go through all menus' shortcuts and check if the key combination pressed is the shortcut
      shortcuts.forEach(({ shortcut, onClick }) => {
        const parts = shortcut.split("+");
        const isShift = parts.includes("Shift");
        const isAlt = parts.includes("Alt");
        const keyBind = parts[parts.length - 1];

        if (!e.shiftKey && isShift) return;
        if (!e.altKey && isAlt) return;
        if (e.key !== keyBind.toLowerCase()) return;

        onClick();
      });
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);

  if (settings.compactMenuBar && !activeMenu) return null;

  return (
    <>
      {/* Backdrop to close menus when clicking outside */}
      {activeMenu && <div className="fixed inset-0 z-20" onClick={() => setActiveMenu(null)} />}

      <div
        className={cn(
          "z-20 flex h-7 items-center bg-primary-bg px-0.5",
          settings.compactMenuBar && "absolute inset-0",
        )}
      >
        {Object.keys(menus).map((menuName) => (
          <div key={menuName} className="relative h-full">
            {/* Menu button */}
            <Button
              variant="ghost"
              className={cn(
                "h-6 px-3 text-text-light text-xs",
                activeMenu === menuName && "bg-selected!",
              )}
              // Click to open menu; click again to close
              onClick={() => setActiveMenu((value) => (value ? null : menuName))}
              // Change menu on hover when a menu is already opened
              onMouseEnter={() => activeMenu !== null && setActiveMenu(menuName)}
            >
              {menuName}
            </Button>

            {/* Menu content */}
            {activeMenu === menuName && (
              <div className="absolute top-full left-0 mt-1">
                {menus[menuName as keyof typeof menus]}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export default CustomMenuBar;
