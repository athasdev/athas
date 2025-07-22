import { enableMapSet } from "immer";
import { useEffect } from "react";
import { FontPreloader } from "./components/font-preloader";
import { FontStyleInjector } from "./components/font-style-injector";
import { MainLayout } from "./components/layout/main-layout";
import WelcomeScreen from "./components/window/welcome-screen";
import { ZoomIndicator } from "./components/zoom-indicator";
import { useFileWatcherEvents } from "./hooks/use-file-watcher-events";
import { useSettingsSync } from "./hooks/use-settings-sync";
import { useAppStore } from "./stores/app-store";
import { useFileSystemStore } from "./stores/file-system-store";
import { useFontStore } from "./stores/font-store";
import { useRecentFoldersStore } from "./stores/recent-folders-store";
import { useSettingsStore } from "./stores/settings-store";
import { useZoomStore } from "./stores/zoom-store";
import { cn } from "./utils/cn";
import { isMac } from "./utils/platform";

// this comment is so file is 69 LOC
function App() {
  enableMapSet();

  const { files, rootFolderPath, handleOpenFolder } = useFileSystemStore();
  const { cleanup } = useAppStore();
  const { recentFolders, openRecentFolder } = useRecentFoldersStore();
  const { loadAvailableFonts } = useFontStore();
  const { zoomLevel, zoomIn, zoomOut } = useZoomStore();
  const { settings } = useSettingsStore();

  // Platform-specific setup
  useEffect(() => {
    if (isMac()) {
      document.documentElement.classList.add("platform-macos");
    } else {
      document.documentElement.classList.add("platform-other");
    }

    return () => {
      document.documentElement.classList.remove("platform-macos", "platform-other");
      cleanup(); // Cleanup autosave timeouts
    };
  }, [cleanup]);

  // Initialize fonts on app start (will use cache if available)
  useEffect(() => {
    loadAvailableFonts();
  }, [loadAvailableFonts]);

  // Mouse wheel zoom functionality
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!settings.mouseWheelZoom) return;

      // Check if Ctrl/Cmd is held (common zoom modifier)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        if (e.deltaY < 0) {
          // Scroll up = zoom in
          zoomIn();
        } else if (e.deltaY > 0) {
          // Scroll down = zoom out
          zoomOut();
        }
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("wheel", handleWheel);
    };
  }, [settings.mouseWheelZoom, zoomIn, zoomOut]);

  // Initialize event listeners
  useFileWatcherEvents();

  // Sync settings with editor config
  useSettingsSync();

  // Check for remote connection from URL
  const urlParams = new URLSearchParams(window.location.search);
  const remoteParam = urlParams.get("remote");
  const isRemoteFromUrl = !!remoteParam;

  // Determine if we should show welcome screen
  const shouldShowWelcome = files.length === 0 && !rootFolderPath && !isRemoteFromUrl;

  if (shouldShowWelcome) {
    return (
      <div>
        <FontPreloader />
        <FontStyleInjector />
        <div style={{ zoom: zoomLevel }}>
          <WelcomeScreen
            onOpenFolder={handleOpenFolder}
            recentFolders={recentFolders}
            onOpenRecentFolder={openRecentFolder}
          />
        </div>
        <ZoomIndicator />
      </div>
    );
  }

  return (
    <div className={cn("flex h-screen w-screen flex-col overflow-hidden bg-transparent")}>
      <FontPreloader />
      <FontStyleInjector />
      <div
        className={cn("window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg")}
        style={{ zoom: zoomLevel }}
      >
        <MainLayout />
      </div>
      <ZoomIndicator />
    </div>
  );
}

export default App;
