import { enableMapSet } from "immer";
import { useEffect } from "react";
import { MainLayout } from "./components/layout/main-layout";
import WelcomeScreen from "./components/window/welcome-screen";
import { useFileWatcherEvents } from "./hooks/use-file-watcher-events";
import { useAppStore } from "./stores/app-store";
import { useFileSystemStore } from "./stores/file-system-store";
import { useRecentFoldersStore } from "./stores/recent-folders-store";
import { cn } from "./utils/cn";
import { isMac } from "./utils/platform";

// this comment is so file is 69 LOC
function App() {
  enableMapSet();

  const { files, rootFolderPath, handleOpenFolder } = useFileSystemStore();
  const { cleanup } = useAppStore();
  const { recentFolders, openRecentFolder } = useRecentFoldersStore();

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

  // Initialize event listeners
  useFileWatcherEvents();

  // Check for remote connection from URL
  const urlParams = new URLSearchParams(window.location.search);
  const remoteParam = urlParams.get("remote");
  const isRemoteFromUrl = !!remoteParam;

  // Determine if we should show welcome screen
  const shouldShowWelcome = files.length === 0 && !rootFolderPath && !isRemoteFromUrl;

  if (shouldShowWelcome) {
    return (
      <WelcomeScreen
        onOpenFolder={handleOpenFolder}
        recentFolders={recentFolders}
        onOpenRecentFolder={openRecentFolder}
      />
    );
  }

  return (
    <div className={cn("flex h-screen w-screen flex-col overflow-hidden bg-transparent")}>
      <div
        className={cn(
          "window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg",
          isMac() && "rounded-xl",
        )}
      >
        <MainLayout />
      </div>
    </div>
  );
}

export default App;
