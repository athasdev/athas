import { enableMapSet } from "immer";
import { useEffect } from "react";
import { useKeymapContext } from "@/features/keymaps/hooks/use-keymap-context";
import { useKeymaps } from "@/features/keymaps/hooks/use-keymaps";
import { useRemoteConnection } from "@/features/remote/hooks/use-remote-connection";
import { useRemoteWindowClose } from "@/features/remote/hooks/use-remote-window-close";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import UpdateDialog from "@/features/settings/components/update-dialog";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { useContextMenuPrevention } from "@/features/window/hooks/use-context-menu-prevention";
import { useFontLoading } from "@/features/window/hooks/use-font-loading";
import { usePlatformSetup } from "@/features/window/hooks/use-platform-setup";
import { useScroll } from "@/features/window/hooks/use-scroll";
import { initializeIconThemes } from "./extensions/icon-themes/icon-theme-initializer";
import { initializeThemeSystem } from "./extensions/themes/theme-initializer";
import {
  cleanupFileWatcherListener,
  initializeFileWatcherListener,
} from "./features/file-system/controllers/file-watcher-store";
import { MainLayout } from "./features/layout/components/main-layout";
import { ZoomIndicator } from "./features/layout/components/zoom-indicator";
import { useZoomStore } from "./stores/zoom-store";
import { ToastContainer } from "./ui/toast";
import { cn } from "./utils/cn";

// Initialize theme system immediately when the module loads
// This ensures themes are loaded before the settings store tries to apply them
initializeThemeSystem().catch(console.error);

// Initialize icon themes
initializeIconThemes();

import { useExtensionInstallPrompt } from "./extensions/hooks/use-extension-install-prompt";
// Initialize extension system
import { extensionLoader } from "./extensions/loader/extension-loader";
import { initializeExtensionStore } from "./extensions/registry/extension-store";
import { initializeWasmTokenizer } from "./features/editor/lib/wasm-parser";
import { initializeKeymaps } from "./features/keymaps/init";
import { useDeepLink } from "./hooks/use-deep-link";

initializeWasmTokenizer().catch(console.error);
extensionLoader.initialize().catch(console.error);
initializeExtensionStore().catch(console.error);
initializeKeymaps();

function App() {
  enableMapSet();

  const zoomLevel = useZoomStore.use.windowZoomLevel();

  // Auto-update check
  const {
    showDialog: showUpdateDialog,
    updateInfo,
    downloadProgress,
    downloading,
    installing,
    error: updateError,
    onDismiss: dismissUpdate,
    onDownload: downloadUpdate,
  } = useAutoUpdate();

  // App initialization and setup hooks
  usePlatformSetup();
  useFontLoading();
  useScroll();
  useDeepLink();
  useExtensionInstallPrompt();
  useKeymapContext();
  useKeymaps();
  useRemoteConnection();
  useRemoteWindowClose();
  useContextMenuPrevention();

  // File watcher setup
  useEffect(() => {
    initializeFileWatcherListener();
    return () => {
      cleanupFileWatcherListener();
    };
  }, []);

  return (
    <div
      className={cn("h-screen w-screen overflow-hidden bg-transparent")}
      style={{ zoom: zoomLevel }}
    >
      <FontStyleInjector />
      <div
        className={cn("window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg")}
      >
        <MainLayout />
      </div>
      <ZoomIndicator />
      <ToastContainer />

      {/* Update Dialog */}
      {showUpdateDialog && updateInfo && (
        <UpdateDialog
          updateInfo={updateInfo}
          downloadProgress={downloadProgress}
          downloading={downloading}
          installing={installing}
          error={updateError}
          onDownload={downloadUpdate}
          onDismiss={dismissUpdate}
        />
      )}
    </div>
  );
}

export default App;
