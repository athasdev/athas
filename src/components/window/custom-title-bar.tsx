import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { Maximize2, Minimize2, Minus, Settings, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import SettingsDialog from "@/settings/components/settings-dialog";
import { usePersistentSettingsStore } from "@/settings/stores/persistent-settings-store";
import { useProjectStore } from "@/stores/project-store";
import { cn } from "@/utils/cn";

interface CustomTitleBarProps {
  title?: string;
  showMinimal?: boolean;
  isWelcomeScreen?: boolean;
  onOpenSettings?: () => void;
}

const CustomTitleBar = ({
  showMinimal = false,
  isWelcomeScreen = false,
  onOpenSettings,
}: CustomTitleBarProps) => {
  const { getProjectName } = useProjectStore();
  const { isAIChatVisible, setIsAIChatVisible } = usePersistentSettingsStore();

  const projectName = getProjectName();
  const [isMaximized, setIsMaximized] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<any>(null);
  const [currentPlatform, setCurrentPlatform] = useState<string>(() => {
    if (typeof navigator !== "undefined") {
      if (navigator.userAgent.includes("Mac")) {
        return "macos";
      } else if (navigator.userAgent.includes("Linux")) {
        return "linux";
      } else {
        return "windows";
      }
    }
    return "other";
  });

  useEffect(() => {
    const initWindow = async () => {
      const window = getCurrentWindow();
      setCurrentWindow(window);

      try {
        const platformName = await platform();
        setCurrentPlatform(platformName);
      } catch (error) {
        console.error("Error getting platform:", error);
        if (typeof navigator !== "undefined") {
          if (navigator.userAgent.includes("Mac")) {
            setCurrentPlatform("macos");
          } else if (navigator.userAgent.includes("Linux")) {
            setCurrentPlatform("linux");
          } else {
            setCurrentPlatform("windows");
          }
        }
      }

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

  const isMacOS = currentPlatform === "macos";
  const isLinux = currentPlatform === "linux";

  if (showMinimal) {
    const backgroundClass = isWelcomeScreen ? "bg-paper-bg" : "bg-primary-bg";

    return (
      <div
        data-tauri-drag-region
        className={`relative z-50 flex select-none items-center justify-between ${
          isMacOS ? "h-11" : "h-7"
        } ${backgroundClass}`}
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
              className="group flex h-7 w-10 items-center justify-center transition-colors hover:bg-red-600"
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
        className="relative z-50 flex h-8 select-none items-center justify-between bg-primary-bg"
      >
        {/* macOS traffic light space holder */}
        <div className="flex items-center space-x-2 pl-4" />

        {/* Center - Project name for macOS */}
        <div className="-translate-x-1/2 pointer-events-none absolute left-1/2 flex transform items-center">
          {projectName && (
            <span className="max-w-60 truncate text-center font-medium text-[10px] text-text">
              {projectName}
            </span>
          )}
        </div>

        {/* Settings and AI Chat buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              setIsAIChatVisible(!isAIChatVisible);
            }}
            className={`flex items-center justify-center rounded p-1 transition-colors ${
              isAIChatVisible
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
      className={cn(
        "relative z-50 flex h-7 select-none items-center justify-between",
        "bg-primary-bg",
      )}
    >
      {/* Left side */}
      <div className="flex flex-1 items-center px-2">
        {projectName && (
          <span className="max-w-96 truncate font-medium text-text text-xs">{projectName}</span>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-0.5">
        {/* AI Chat button */}
        <button
          onClick={() => {
            setIsAIChatVisible(!isAIChatVisible);
          }}
          className={`flex items-center justify-center rounded px-1 py-0.5 transition-colors ${
            isAIChatVisible
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
              className="group flex h-7 w-10 items-center justify-center transition-colors hover:bg-red-600"
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Handle Cmd+, (Mac) or Ctrl+, (Windows/Linux) to open settings
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.includes("Mac");
      const isSettingsShortcut = event.key === "," && (isMac ? event.metaKey : event.ctrlKey);

      if (isSettingsShortcut) {
        event.preventDefault();
        setIsSettingsOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <CustomTitleBar {...props} onOpenSettings={() => setIsSettingsOpen(true)} />
      <SettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
};

export default CustomTitleBarWithSettings;
