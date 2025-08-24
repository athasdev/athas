import { emit } from "@tauri-apps/api/event";
import type React from "react";

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

  // Shortcuts are written in MacOS format and converted for users on other operating systems
  const menus = {
    File: (
      <Menu>
        <MenuItem shortcut="⌘N" onClick={() => handleClick("menu_new_file")}>
          New File
        </MenuItem>
        <MenuItem shortcut="⌘O" onClick={() => handleClick("menu_open_folder")}>
          Open Folder
        </MenuItem>
        <MenuItem separator />
        <MenuItem shortcut="⌘S" onClick={() => handleClick("menu_save")}>
          Save
        </MenuItem>
        <MenuItem shortcut="⇧⌘S" onClick={() => handleClick("menu_save_as")}>
          Save As...
        </MenuItem>
        <MenuItem separator />
        <MenuItem shortcut="⌘W" onClick={() => handleClick("menu_close_tab")}>
          Close Tab
        </MenuItem>
      </Menu>
    ),
    Edit: (
      <Menu>
        <MenuItem shortcut="⌘Z" onClick={() => handleClick("menu_undo")}>
          Undo
        </MenuItem>
        <MenuItem shortcut="⇧⌘Z" onClick={() => handleClick("menu_redo")}>
          Redo
        </MenuItem>
        <MenuItem separator />
        <MenuItem shortcut="⌘X">Cut</MenuItem>
        <MenuItem shortcut="⌘C">Copy</MenuItem>
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
          <MenuItem onClick={() => handleClick("menu_theme_change", "midnight")}>Midnight</MenuItem>
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
  };

  if (settings.compactMenuBar && !activeMenu) return;

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
