import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { Bot, Maximize2, Minimize2, Minus, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";

interface CustomTitleBarProps {
  title?: string;
  projectName?: string;
  showMinimal?: boolean;
  isWelcomeScreen?: boolean;
  onSettingsClick?: () => void;
  onAIChatClick?: () => void;
  isAIChatVisible?: boolean;
}

const CustomTitleBar = ({
  projectName,
  showMinimal = false,
  isWelcomeScreen = false,
  onSettingsClick,
  onAIChatClick,
  isAIChatVisible = false,
}: CustomTitleBarProps) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [currentWindow, setCurrentWindow] = useState<any>(null);
  const [currentPlatform, setCurrentPlatform] = useState<string>(() => {
    if (typeof navigator !== "undefined") {
      return navigator.userAgent.includes("Mac") ? "macos" : "other";
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
        if (typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")) {
          setCurrentPlatform("macos");
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

  if (showMinimal) {
    const backgroundClass = isWelcomeScreen
      ? "bg-paper-bg"
      : isMacOS
        ? "bg-primary-bg"
        : "bg-secondary-bg backdrop-blur-sm";

    return (
      <div
        data-tauri-drag-region
        className={`relative z-50 flex select-none items-center justify-between ${
          isMacOS ? "h-11" : "h-7"
        } ${backgroundClass}`}
      >
        {/* macOS traffic light controls */}
        {isMacOS && (
          <div className="flex items-center space-x-2 pl-4">
            <button
              onClick={handleClose}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-red-500 transition-colors hover:bg-red-600"
              title="Close"
            >
              <X className="h-2 w-2 text-red-900 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <button
              onClick={handleMinimize}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-yellow-500 transition-colors hover:bg-yellow-600"
              title="Minimize"
            >
              <Minus className="h-2 w-2 text-yellow-900 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-green-500 transition-colors hover:bg-green-600"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Minimize2 className="h-2 w-2 text-green-900 opacity-0 transition-opacity group-hover:opacity-100" />
              ) : (
                <Maximize2 className="h-2 w-2 text-green-900 opacity-0 transition-opacity group-hover:opacity-100" />
              )}
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Windows controls */}
        {!isMacOS && (
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
        {/* macOS traffic light controls */}
        <div className="flex items-center space-x-2 pl-4">
          <button
            onClick={handleClose}
            className="group flex h-3 w-3 items-center justify-center rounded-full bg-red-500 transition-colors hover:bg-red-600"
            title="Close"
          >
            <X className="h-2 w-2 text-red-900 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <button
            onClick={handleMinimize}
            className="group flex h-3 w-3 items-center justify-center rounded-full bg-yellow-500 transition-colors hover:bg-yellow-600"
            title="Minimize"
          >
            <Minus className="h-2 w-2 text-yellow-900 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <button
            onClick={handleToggleMaximize}
            className="group flex h-3 w-3 items-center justify-center rounded-full bg-green-500 transition-colors hover:bg-green-600"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <Minimize2 className="h-2 w-2 text-green-900 opacity-0 transition-opacity group-hover:opacity-100" />
            ) : (
              <Maximize2 className="h-2 w-2 text-green-900 opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </button>
        </div>

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
          {onAIChatClick && (
            <button
              onClick={onAIChatClick}
              className={`flex items-center justify-center rounded p-1 transition-colors ${
                isAIChatVisible
                  ? "bg-selected text-text"
                  : "text-text-lighter hover:bg-hover hover:text-text"
              }`}
              style={{ minHeight: 0, minWidth: 0 }}
              title="Toggle AI Chat"
            >
              <Bot size={14} />
            </button>
          )}
          {onSettingsClick && (
            <button
              onClick={onSettingsClick}
              className="mr-4 flex items-center justify-center rounded p-1 text-text-lighter transition-colors hover:bg-hover hover:text-text"
              style={{ minHeight: 0, minWidth: 0 }}
              title="Settings"
            >
              <Settings size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Windows/Linux full title bar
  return (
    <div
      data-tauri-drag-region
      className="relative z-50 flex h-7 select-none items-center justify-between bg-secondary-bg backdrop-blur-sm"
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
        {onAIChatClick && (
          <button
            onClick={onAIChatClick}
            className={`flex items-center justify-center rounded px-1 py-0.5 transition-colors ${
              isAIChatVisible
                ? "bg-selected text-text"
                : "text-text-lighter hover:bg-hover hover:text-text"
            }`}
            style={{ minHeight: 0, minWidth: 0 }}
            title="Toggle AI Chat"
          >
            <Bot size={12} />
          </button>
        )}
        {/* Settings button */}
        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            className="mr-2 flex items-center justify-center rounded px-1 py-0.5 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            style={{ minHeight: 0, minWidth: 0 }}
            title="Settings"
          >
            <Settings size={12} />
          </button>
        )}

        {/* Windows controls */}
        {
          <>
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
          </>
        }
      </div>
    </div>
  );
};

export default CustomTitleBar;
