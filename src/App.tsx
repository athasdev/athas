import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import { useSidebarStore } from "./stores/sidebar-store";
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
  const setRemoteWindow = useSidebarStore.use.setRemoteWindow();
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

  // Listen for remote connection info and handle remote window setup
  useEffect(() => {
    // Check if this is a remote window from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const remoteParam = urlParams.get("remote");
    if (remoteParam) {
      setRemoteWindow(true, undefined, remoteParam);
    }

    // Set up event listener for remote connection info from Tauri
    let unlistenRemoteInfo: (() => void) | null = null;

    const setupRemoteListener = async () => {
      try {
        unlistenRemoteInfo = await listen<{
          connectionId: string;
          connectionName: string;
          isRemoteWindow: boolean;
        }>("remote-connection-info", (event) => {
          const { isRemoteWindow, connectionName, connectionId } = event.payload;
          setRemoteWindow(isRemoteWindow, connectionName, connectionId);
        });
      } catch (error) {
        console.error("Failed to set up remote connection listener:", error);
      }
    };

    setupRemoteListener();

    return () => {
      if (unlistenRemoteInfo) {
        unlistenRemoteInfo();
      }
    };
  }, [setRemoteWindow]);

  // Handle window close request for remote connections
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const remoteParam = urlParams.get("remote");

    if (!remoteParam) return;

    let unlistenCloseRequested: (() => void) | null = null;

    const setupCloseListener = async () => {
      try {
        const currentWindow = getCurrentWebviewWindow();

        unlistenCloseRequested = await currentWindow.onCloseRequested(async (event) => {
          event.preventDefault();

          try {
            await invoke("ssh_disconnect_only", { connectionId: remoteParam });
            await emit("remote-connection-disconnected", { connectionId: remoteParam });
            await currentWindow.destroy();
          } catch (error) {
            console.error("Failed to cleanup on window close:", error);
            await currentWindow.destroy();
          }
        });
      } catch (error) {
        console.error("Failed to set up window close listener:", error);
      }
    };

    setupCloseListener();

    return () => {
      unlistenCloseRequested?.();
    };
  }, []);

  // Hide native context menu
  useEffect(() => {
    if (import.meta.env.MODE === "production") {
      const handleContextMenu = (event: MouseEvent) => {
        event.preventDefault();
      };
      document.addEventListener("contextmenu", handleContextMenu);
      return () => {
        document.removeEventListener("contextmenu", handleContextMenu);
      };
    }
  }, []);

  // Check for remote connection from URL
  const urlParams = new URLSearchParams(window.location.search);
  const remoteParam = urlParams.get("remote");
  const isRemoteFromUrl = !!remoteParam;

  // Determine if we should show welcome screen
  const shouldShowWelcome = files.length === 0 && !rootFolderPath && !isRemoteFromUrl;

  if (shouldShowWelcome) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-transparent" style={{ zoom: zoomLevel }}>
        <FontPreloader />
        <FontStyleInjector />
        <div className="h-full w-full">
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
    <div
      className={cn("h-screen w-screen overflow-hidden bg-transparent")}
      style={{ zoom: zoomLevel }}
    >
      <FontPreloader />
      <FontStyleInjector />
      <div
        className={cn("window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg")}
      >
        <MainLayout />
      </div>
      <ZoomIndicator />
      <ToastContainer />
    </div>
  );
}

export default App;
