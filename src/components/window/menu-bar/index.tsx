import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import type React from "react";
import { isValidElement, type JSX, useEffect, useMemo } from "react";
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

  const handleClickEmit = (event: string, payload?: unknown) => {
    emit(event, payload);
    setActiveMenu(null);
  };

  const menus = useMemo(
    () => ({
      File: (
        <Menu>
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
        <Menu>
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
        <Menu>
          <MenuItem shortcut="Ctrl+B" onClick={() => handleClickEmit("menu_toggle_sidebar")}>
            Toggle Sidebar
          </MenuItem>
          <MenuItem shortcut="Ctrl+J" onClick={() => handleClickEmit("menu_toggle_terminal")}>
            Toggle Terminal
          </MenuItem>
          <MenuItem shortcut="Ctrl+R" onClick={() => handleClickEmit("menu_toggle_ai_chat")}>
            Toggle AI Chat
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
            <MenuItem onClick={() => handleClickEmit("menu_theme_change", "auto")}>Auto</MenuItem>
            <MenuItem separator />
            <MenuItem onClick={() => handleClickEmit("menu_theme_change", "light")}>Light</MenuItem>
            <MenuItem onClick={() => handleClickEmit("menu_theme_change", "dark")}>Dark</MenuItem>
            <MenuItem onClick={() => handleClickEmit("menu_theme_change", "midnight")}>
              Midnight
            </MenuItem>
            <MenuItem separator />
            <MenuItem onClick={() => handleClickEmit("menu_theme_change", "catppuccin_mocha")}>
              Catppuccin Mocha
            </MenuItem>
            <MenuItem onClick={() => handleClickEmit("menu_theme_change", "tokyo_night")}>
              Tokyo Night
            </MenuItem>
            <MenuItem onClick={() => handleClickEmit("menu_theme_change", "dracula")}>
              Dracula
            </MenuItem>
            <MenuItem onClick={() => handleClickEmit("menu_theme_change", "nord")}>Nord</MenuItem>
          </Submenu>
        </Menu>
      ),
      Go: (
        <Menu>
          <MenuItem shortcut="Ctrl+P" onClick={() => handleClickEmit("menu_go_to_file")}>
            Go to File
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
        <Menu>
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
        <Menu>
          <MenuItem onClick={() => handleClickEmit("menu_help")}>Help</MenuItem>
          <MenuItem separator />
          <MenuItem onClick={() => handleClickEmit("menu_about_athas")}>About Athas</MenuItem>
        </Menu>
      ),
    }),
    [handleClickEmit, setActiveMenu],
  );

  // Extract shortcuts from menus
  const shortcuts = useMemo(() => {
    const extractShortcuts = (
      element: JSX.Element,
    ): { shortcut: string; onClick: () => void }[] => {
      const result: { shortcut: string; onClick: () => void }[] = [];

      if (element.props.shortcut && element.props.onClick) {
        result.push({
          shortcut: element.props.shortcut,
          onClick: element.props.onClick,
        });
      }

      // Handle children (including nested submenus)
      const children = element.props.children;
      if (children) {
        const childArray = Array.isArray(children) ? children : [children];
        childArray.forEach((child) => {
          if (isValidElement(child)) {
            result.push(...extractShortcuts(child));
          }
        });
      }

      return result;
    };

    return Object.values(menus).flatMap((menu) => extractShortcuts(menu));
  }, [menus]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if a shortcut combination was pressed
      shortcuts.forEach(({ shortcut, onClick }) => {
        const parts = shortcut.split("+");
        const requiredCtrl = parts.includes("Ctrl");
        const requiredAlt = parts.includes("Alt");
        const requiredShift = parts.includes("Shift");
        const keyPart = parts[parts.length - 1];

        let expectedKey = keyPart.toLowerCase();
        if (keyPart === "Left") expectedKey = "arrowleft";
        if (keyPart === "Right") expectedKey = "arrowright";

        const keyMatches = e.key.toLowerCase() === expectedKey;

        const modifiersMatch =
          (requiredCtrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey) &&
          (requiredAlt ? e.altKey : !e.altKey) &&
          (requiredShift ? e.shiftKey : !e.shiftKey);

        if (keyMatches && modifiersMatch) {
          e.preventDefault();
          onClick();
        }
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
