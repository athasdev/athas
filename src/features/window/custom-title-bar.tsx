import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, MenuIcon, Minimize2, Minus, Settings, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import { useSettingsStore } from "@/features/settings/store";
import { useIsLinux, useIsMac } from "@/hooks/use-platform";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";
import { connectionStore } from "@/utils/connection-store";
import { getFolderName } from "@/utils/path-helpers";
import ProjectTabs from "./components/project-tabs";
import CustomMenuBar from "./menu-bar";

interface CustomTitleBarProps {
  title?: string;
  showMinimal?: boolean;
  onOpenSettings?: () => void;
}

const CustomTitleBar = ({ showMinimal = false, onOpenSettings }: CustomTitleBarProps) => {
  const { settings, updateSetting } = useSettingsStore();

  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<any>(null);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const [projectName, setProjectName] = useState<string>("Explorer");
  
  const isMacOS = useIsMac();
  const isLinux = useIsLinux();

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
  
 useEffect(() => {
    const setupProjectName = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const remoteConnectionId = urlParams.get("remote");

      if (remoteConnectionId) {
        try {
          const connection = await connectionStore.getConnection(remoteConnectionId);
          setProjectName(connection ? `Remote: ${connection.name}` : "Remote");
        } catch (error) {
          console.error("Error getting remote connection:", error);
          setProjectName("Remote");
        }
      } else {
        setProjectName(rootFolderPath ? getFolderName(rootFolderPath) : "Explorer");
      }
    };

    setupProjectName();
  }, [rootFolderPath]);

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
            <button
              onClick={handleMinimize}
              className="flex h-7 w-10 items-center justify-center transition-colors hover:bg-hover"
              title="Minimize"
            >
              <Minus className="h-3.5 w-3.5 text-text-lighter" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="flex h-7 w-10 items-center justify-center transition-colors hover:bg-hover"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5 text-text-lighter" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5 text-text-lighter" />
              )}
            </button>
            <button
              onClick={handleClose}
              className="group flex h-7 w-10 items-center justify-center transition-colors hover:bg-error"
              title="Close"
            >
              <X className="h-3.5 w-3.5 text-text-lighter group-hover:text-white" />
            </button>
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
        <div className="flex items-center space-x-2 pl-4" />

        {/* Center - Project tabs for macOS */}
        <div className="-translate-x-1/2 pointer-events-auto absolute left-1/2 flex transform items-center">
          <ProjectTabs />
        </div>

        {/* Settings and AI Chat buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              updateSetting("isAIChatVisible", !settings.isAIChatVisible);
            }}
            className={`flex items-center justify-center rounded p-1 transition-colors ${
              settings.isAIChatVisible
                ? "bg-selected text-text"
                : "text-text-lighter hover:bg-hover hover:text-text"
            }`}
            style={{ minHeight: 0, minWidth: 0 }}
            title="Toggle AI Chat"
          >
            <Sparkles size={14} />
          </button>
          <button
            onClick={onOpenSettings}
            className={cn(
              "mr-4 flex items-center justify-center rounded p-1",
              "text-text-lighter transition-colors hover:bg-hover hover:text-text",
            )}
            style={{ minHeight: 0, minWidth: 0 }}
            title="Settings"
          >
            <Settings size={14} />
          </button>
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
      <div className="flex flex-1 items-center px-2">
        {/* Menu bar button */}
        {!settings.nativeMenuBar && settings.compactMenuBar && (
          <button
            onClick={() => {
              setMenuBarActiveMenu("File");
            }}
            className={`mr-2 flex items-center justify-center rounded py-0.5 text-text`}
            title="Open Menu Bar"
          >
            <MenuIcon size={16} />
          </button>
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
        {/* AI Chat button */}
        <button
          onClick={() => {
            updateSetting("isAIChatVisible", !settings.isAIChatVisible);
          }}
          className={`flex items-center justify-center rounded px-1 py-0.5 transition-colors ${
            settings.isAIChatVisible
              ? "bg-selected text-text"
              : "text-text-lighter hover:bg-hover hover:text-text"
          }`}
          style={{ minHeight: 0, minWidth: 0 }}
          title="Toggle AI Chat"
        >
          <Sparkles size={12} />
        </button>
        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className={cn(
            "mr-2 flex items-center justify-center rounded px-1 py-0.5",
            "text-text-lighter transition-colors hover:bg-hover hover:text-text",
          )}
          style={{ minHeight: 0, minWidth: 0 }}
          title="Settings"
        >
          <Settings size={12} />
        </button>

        {/* Window controls - only show on Linux */}
        {isLinux && (
          <div className="flex items-center">
            <button
              onClick={handleMinimize}
              className="flex h-7 w-10 items-center justify-center transition-colors hover:bg-hover"
              title="Minimize"
            >
              <Minus className="h-3.5 w-3.5 text-text-lighter" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="flex h-7 w-10 items-center justify-center transition-colors hover:bg-hover"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5 text-text-lighter" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5 text-text-lighter" />
              )}
            </button>
            <button
              onClick={handleClose}
              className="group flex h-7 w-10 items-center justify-center transition-colors hover:bg-error"
              title="Close"
            >
              <X className="h-3.5 w-3.5 text-text-lighter group-hover:text-white" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const CustomTitleBarWithSettings = (props: Omit<CustomTitleBarProps, "onOpenSettings">) => {
  const isSettingsDialogVisible = useUIState((state) => state.isSettingsDialogVisible);
  const setIsSettingsDialogVisible = useUIState((state) => state.setIsSettingsDialogVisible);

  // Handle Cmd+, (Mac) or Ctrl+, (Windows/Linux) to open settings
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.includes("Mac");
      const isSettingsShortcut = event.key === "," && (isMac ? event.metaKey : event.ctrlKey);

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
      <CustomTitleBar {...props} onOpenSettings={() => setIsSettingsDialogVisible(true)} />
      <SettingsDialog
        isOpen={isSettingsDialogVisible}
        onClose={() => setIsSettingsDialogVisible(false)}
      />
    </>
  );
};

export default CustomTitleBarWithSettings;
