import { enableMapSet } from "immer";
import { useEffect } from "react";
import { FontPreloader } from "./components/font-preloader";
import { FontStyleInjector } from "./components/font-style-injector";
import { MainLayout } from "./components/layout/main-layout";
import { ToastContainer } from "./components/ui/toast";
import WelcomeScreen from "./components/window/welcome-screen";
import { ZoomIndicator } from "./components/zoom-indicator";
import { initializeThemeSystem } from "./extensions/themes/theme-initializer";
import {
  cleanupFileWatcherListener,
  initializeFileWatcherListener,
} from "./file-system/controllers/file-watcher-store";
import { isMac } from "./file-system/controllers/platform";
import { useRecentFoldersStore } from "./file-system/controllers/recent-folders-store";
import { useFileSystemStore } from "./file-system/controllers/store";
import { useScroll } from "./hooks/use-scroll";
import { useAppStore } from "./stores/app-store";
import { useFontStore } from "./stores/font-store";
import { useZoomStore } from "./stores/zoom-store";
import { cn } from "./utils/cn";

// Initialize theme system immediately when the module loads
// This ensures themes are loaded before the settings store tries to apply them
initializeThemeSystem().catch(console.error);

function App() {
  enableMapSet();

  const { files, rootFolderPath, handleOpenFolder } = useFileSystemStore();
  const { cleanup } = useAppStore.use.actions();
  const { recentFolders, openRecentFolder } = useRecentFoldersStore();
  const { loadAvailableFonts } = useFontStore.use.actions();
  const zoomLevel = useZoomStore.use.zoomLevel();

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
  useScroll();

  // Initialize file watcher
  useEffect(() => {
    initializeFileWatcherListener();
    return () => {
      cleanupFileWatcherListener();
    };
  }, []);

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
        <ToastContainer />
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
      <ToastContainer />
    </div>
  );
}

export default App;
