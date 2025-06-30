import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { Minus, Maximize2, Minimize2, X, Settings } from "lucide-react";

interface CustomTitleBarProps {
  title?: string;
  projectName?: string;
  showMinimal?: boolean;
  onSettingsClick?: () => void;
}

const CustomTitleBar = ({
  projectName,
  showMinimal = false,
  onSettingsClick,
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
        const platformName = platform();
        setCurrentPlatform(platformName);
      } catch (error) {
        console.error("Error getting platform:", error);
        if (
          typeof navigator !== "undefined" &&
          navigator.userAgent.includes("Mac")
        ) {
          setCurrentPlatform("macos");
        }
      }

      const unlisten = await window.onResized(async () => {
        const maximized = await window.isMaximized();
        setIsMaximized(maximized);
      });

      try {
        const maximized = await window.isMaximized();
        setIsMaximized(maximized);
      } catch (error) {}

      return () => {
        unlisten();
      };
    };

    initWindow();
  }, []);

  useEffect(() => {}, [isMaximized]);

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
    return (
      <div
        data-tauri-drag-region
        className={`flex items-center justify-between select-none relative z-50 ${
          isMacOS
            ? "h-11 bg-transparent"
            : "h-7 bg-[var(--secondary-bg)] backdrop-blur-sm border-b border-[var(--border-color)]"
        }`}
      >
        {/* macOS traffic light controls */}
        {isMacOS && (
          <div className="flex items-center space-x-2 pl-4">
            <button
              onClick={handleClose}
              className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center group"
              title="Close"
            >
              <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              onClick={handleMinimize}
              className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors flex items-center justify-center group"
              title="Minimize"
            >
              <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors flex items-center justify-center group"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Minimize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
              ) : (
                <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
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
              className="w-10 h-7 flex items-center justify-center hover:bg-[var(--hover-color)] transition-colors"
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5 text-[var(--text-lighter)]" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="w-10 h-7 flex items-center justify-center hover:bg-[var(--hover-color)] transition-colors"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Minimize2 className="w-3.5 h-3.5 text-[var(--text-lighter)]" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-[var(--text-lighter)]" />
              )}
            </button>
            <button
              onClick={handleClose}
              className="w-10 h-7 flex items-center justify-center hover:bg-red-600 transition-colors group"
              title="Close"
            >
              <X className="w-3.5 h-3.5 text-[var(--text-lighter)] group-hover:text-white" />
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
        className="flex items-center justify-between select-none relative z-50 h-11 bg-transparent"
      >
        {/* macOS traffic light controls */}
        <div className="flex items-center space-x-2 pl-4">
          <button
            onClick={handleClose}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center group"
            title="Close"
          >
            <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <button
            onClick={handleMinimize}
            className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors flex items-center justify-center group"
            title="Minimize"
          >
            <Minus className="w-2 h-2 text-yellow-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <button
            onClick={handleToggleMaximize}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors flex items-center justify-center group"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <Minimize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            ) : (
              <Maximize2 className="w-2 h-2 text-green-900 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        </div>

        {/* Center - Project name for macOS */}
        <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center pointer-events-none">
          {projectName && (
            <span className="text-[var(--text-color)] text-xs font-medium truncate max-w-60 text-center">
              {projectName}
            </span>
          )}
        </div>

        {/* Settings button */}
        <div className="flex items-center">
          {onSettingsClick && (
            <button
              onClick={onSettingsClick}
              className="w-6 h-6 flex items-center justify-center hover:bg-[var(--hover-color)] transition-colors rounded mr-4"
              title="Settings"
            >
              <Settings className="w-3 h-3 text-[var(--text-lighter)] hover:text-[var(--text-color)]" />
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
      className="flex items-center justify-between select-none relative z-50 h-7 bg-[var(--secondary-bg)] backdrop-blur-sm border-b border-[var(--border-color)]"
    >
      {/* Left side */}
      <div className="flex items-center px-2 flex-1">
        {projectName && (
          <span className="text-[var(--text-color)] text-xs font-medium truncate max-w-96">
            {projectName}
          </span>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center">
        {/* Settings button */}
        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            className="w-7 h-7 flex items-center justify-center hover:bg-[var(--hover-color)] transition-colors rounded mr-2"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5 text-[var(--text-lighter)] hover:text-[var(--text-color)]" />
          </button>
        )}

        {/* Windows controls */}
        {
          <>
            <button
              onClick={handleMinimize}
              className="w-10 h-7 flex items-center justify-center hover:bg-[var(--hover-color)] transition-colors"
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5 text-[var(--text-lighter)]" />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="w-10 h-7 flex items-center justify-center hover:bg-[var(--hover-color)] transition-colors"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Minimize2 className="w-3.5 h-3.5 text-[var(--text-lighter)]" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-[var(--text-lighter)]" />
              )}
            </button>
            <button
              onClick={handleClose}
              className="w-10 h-7 flex items-center justify-center hover:bg-red-600 transition-colors group"
              title="Close"
            >
              <X className="w-3.5 h-3.5 text-[var(--text-lighter)] group-hover:text-white" />
            </button>
          </>
        }
      </div>
    </div>
  );
};

export default CustomTitleBar;
