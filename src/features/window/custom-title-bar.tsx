import { getCurrentWindow } from "@tauri-apps/api/window";
import { CircleUser, Maximize2, MenuIcon, Minimize2, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { IS_LINUX, IS_MAC } from "@/utils/platform";
import ProjectTabs from "./components/project-tabs";
import CustomMenuBar from "./menu-bar";

interface CustomTitleBarProps {
  title?: string;
  showMinimal?: boolean;
}

const CustomTitleBar = ({ showMinimal = false }: CustomTitleBarProps) => {
  const { settings } = useSettingsStore();

  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<any>(null);

  const isMacOS = IS_MAC;
  const isLinux = IS_LINUX;

  useEffect(() => {
    const initWindow = async () => {
      const window = getCurrentWindow();
      setCurrentWindow(window);

      try {
        const maximized = await window.isMaximized();
        setIsMaximized(maximized);
      } catch (error) {
        console.error("Error checking maximized state:", error);
      }
    };

    initWindow();
  }, []);

  const handleMinimize = async () => {
    try {
      await currentWindow?.minimize();
    } catch (error) {
      console.error("Error minimizing window:", error);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await currentWindow?.toggleMaximize();
      const maximized = await currentWindow?.isMaximized();
      setIsMaximized(maximized);
    } catch (error) {
      console.error("Error toggling maximize:", error);
    }
  };

  const handleClose = async () => {
    try {
      await currentWindow?.close();
    } catch (error) {
      console.error("Error closing window:", error);
    }
  };

  if (showMinimal) {
    return (
      <div
        data-tauri-drag-region
        className={`relative z-50 flex select-none items-center justify-between ${
          isMacOS ? "h-11" : "h-7"
        } bg-primary-bg`}
      >
        <div className="flex-1" />

        {/* Window controls - only show on Linux */}
        {isLinux && (
          <div className="flex items-center">
            <Tooltip content="Minimize" side="bottom">
              <button
                onClick={handleMinimize}
                className="flex h-7 w-10 items-center justify-center transition-colors hover:bg-hover"
              >
                <Minus className="h-3.5 w-3.5 text-text-lighter" />
              </button>
            </Tooltip>
            <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
              <button
                onClick={handleToggleMaximize}
                className="flex h-7 w-10 items-center justify-center transition-colors hover:bg-hover"
              >
                {isMaximized ? (
                  <Minimize2 className="h-3.5 w-3.5 text-text-lighter" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5 text-text-lighter" />
                )}
              </button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <button
                onClick={handleClose}
                className="group flex h-7 w-10 items-center justify-center transition-colors hover:bg-error"
              >
                <X className="h-3.5 w-3.5 text-text-lighter group-hover:text-white" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    );
  }

  // Full mode with custom controls
  if (isMacOS) {
    return (
      <div
        data-tauri-drag-region
        className="relative z-50 flex h-9 select-none items-center justify-between bg-primary-bg pl-0.5"
      >
        {!settings.nativeMenuBar && (
          <CustomMenuBar activeMenu={menuBarActiveMenu} setActiveMenu={setMenuBarActiveMenu} />
        )}

        {/* macOS traffic light space holder */}
        <div className="flex items-center space-x-2 pl-3" />

        {/* Center - Project tabs for macOS */}
        <div className="-translate-x-1/2 pointer-events-auto absolute left-1/2 flex transform items-center">
          <ProjectTabs />
        </div>

        {/* Account dropdown placeholder */}
        <div className="flex items-center gap-0.5">
          <Tooltip content="Account" side="bottom">
            <button
              className={cn(
                "mr-4 flex items-center justify-center rounded p-1",
                "text-text-lighter transition-colors hover:bg-hover hover:text-text",
              )}
              style={{ minHeight: 0, minWidth: 0 }}
            >
              <CircleUser size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
    );
  }

  // Windows/Linux full title bar
  return (
    <div
      data-tauri-drag-region
      className={"z-50 flex h-7 select-none items-center justify-between bg-primary-bg"}
    >
      {!settings.nativeMenuBar && (
        <CustomMenuBar activeMenu={menuBarActiveMenu} setActiveMenu={setMenuBarActiveMenu} />
      )}

      {/* Left side */}
      <div data-tauri-drag-region className="flex flex-1 items-center px-2">
        {/* Menu bar button */}
        {!settings.nativeMenuBar && settings.compactMenuBar && (
          <Tooltip content="Menu" side="bottom">
            <button
              onClick={() => {
                setMenuBarActiveMenu("File");
              }}
              className={`mr-2 flex items-center justify-center rounded py-0.5 text-text`}
            >
              <MenuIcon size={16} />
            </button>
          </Tooltip>
        )}

        {/* Project tabs */}
        <div
          className={cn(
            !settings.nativeMenuBar &&
              !settings.compactMenuBar &&
              "-translate-x-1/2 absolute left-1/2",
          )}
        >
          <ProjectTabs />
        </div>
      </div>

      {/* Right side */}
      <div className="z-20 flex items-center gap-0.5">
        {/* Account dropdown placeholder */}
        <Tooltip content="Account" side="bottom">
          <button
            className={cn(
              "mr-2 flex items-center justify-center rounded px-1 py-0.5",
              "text-text-lighter transition-colors hover:bg-hover hover:text-text",
            )}
            style={{ minHeight: 0, minWidth: 0 }}
          >
            <CircleUser size={12} />
          </button>
        </Tooltip>

        {/* Window controls - only show on Linux */}
        {isLinux && (
          <div className="flex items-center">
            <Tooltip content="Minimize" side="bottom">
              <button
                onClick={handleMinimize}
                className="flex h-7 w-10 items-center justify-center transition-colors hover:bg-hover"
              >
                <Minus className="h-3.5 w-3.5 text-text-lighter" />
              </button>
            </Tooltip>
            <Tooltip content={isMaximized ? "Restore" : "Maximize"} side="bottom">
              <button
                onClick={handleToggleMaximize}
                className="flex h-7 w-10 items-center justify-center transition-colors hover:bg-hover"
              >
                {isMaximized ? (
                  <Minimize2 className="h-3.5 w-3.5 text-text-lighter" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5 text-text-lighter" />
                )}
              </button>
            </Tooltip>
            <Tooltip content="Close" side="bottom">
              <button
                onClick={handleClose}
                className="group flex h-7 w-10 items-center justify-center transition-colors hover:bg-error"
              >
                <X className="h-3.5 w-3.5 text-text-lighter group-hover:text-white" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
};

const CustomTitleBarWithSettings = (props: CustomTitleBarProps) => {
  const isSettingsDialogVisible = useUIState((state) => state.isSettingsDialogVisible);
  const setIsSettingsDialogVisible = useUIState((state) => state.setIsSettingsDialogVisible);

  // Handle Cmd+, (Mac) or Ctrl+, (Windows/Linux) to open settings
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSettingsShortcut = event.key === "," && (IS_MAC ? event.metaKey : event.ctrlKey);

      if (isSettingsShortcut) {
        event.preventDefault();
        setIsSettingsDialogVisible(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setIsSettingsDialogVisible]);

  return (
    <>
      <CustomTitleBar {...props} />
      <SettingsDialog
        isOpen={isSettingsDialogVisible}
        onClose={() => setIsSettingsDialogVisible(false)}
      />
    </>
  );
};

export default CustomTitleBarWithSettings;
