import { enableMapSet } from "immer";
import { lazy, Suspense, useEffect } from "react";
import { useLspInitialization } from "@/features/editor/hooks/use-lsp-initialization";
import { useKeymapContext } from "@/features/keymaps/hooks/use-keymap-context";
import { useKeymaps } from "@/features/keymaps/hooks/use-keymaps";
import { useRemoteConnection } from "@/features/remote/hooks/use-remote-connection";
import { useRemoteWindowClose } from "@/features/remote/hooks/use-remote-window-close";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new-store";

const UpdateDialog = lazy(() => import("@/features/settings/components/update-dialog"));

import { useContextMenuPrevention } from "@/features/window/hooks/use-context-menu-prevention";
import { useFontLoading } from "@/features/window/hooks/use-font-loading";
import { usePlatformSetup } from "@/features/window/hooks/use-platform-setup";
import { initializeIconThemes } from "./extensions/icon-themes/icon-theme-initializer";
import { initializeThemeSystem } from "./extensions/themes/theme-initializer";
import {
  cleanupFileClipboardListener,
  initializeFileClipboardListener,
} from "./features/file-explorer/stores/file-explorer-clipboard-listener";
import {
  cleanupFileWatcherListener,
  initializeFileWatcherListener,
} from "./features/file-system/controllers/file-watcher-store";
import { MainLayout } from "./features/layout/components/main-layout";
import { ZoomIndicator } from "./features/layout/components/zoom-indicator";
import { ToastContainer } from "./ui/toast";

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
import { WindowResizeBorder } from "./features/window/window-resize-border";
import { useCliOpen } from "./features/window/hooks/use-cli-open";
import { useDeepLink } from "./features/window/hooks/use-deep-link";
import { useAuthStore } from "./stores/auth-store";

initializeWasmTokenizer().catch(console.error);
extensionLoader.initialize().catch(console.error);
initializeExtensionStore().catch(console.error);
initializeKeymaps();

function App() {
  enableMapSet();

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
  const initializeWhatsNew = useWhatsNewStore((state) => state.initialize);

  // App initialization and setup hooks
  usePlatformSetup();
  useFontLoading();
  useDeepLink();
  useCliOpen();
  useExtensionInstallPrompt();
  useKeymapContext();
  useKeymaps();
  useRemoteConnection();
  useRemoteWindowClose();
  useContextMenuPrevention();
  useLspInitialization();

  // Auth initialization
  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);

  useEffect(() => {
    void initializeWhatsNew();
  }, [initializeWhatsNew]);

  // File watcher setup
  useEffect(() => {
    initializeFileWatcherListener();
    return () => {
      cleanupFileWatcherListener();
    };
  }, []);

  // File clipboard cross-window sync
  useEffect(() => {
    initializeFileClipboardListener();
    return () => {
      cleanupFileClipboardListener();
    };
  }, []);

  return (
    <>
      {/* Linux window resize handles (must be outside zoom container) */}
      <WindowResizeBorder />

      <div className="h-dvh w-dvw overflow-hidden">
        <FontStyleInjector />
        <div className="window-container flex h-full w-full flex-col overflow-hidden bg-primary-bg">
          <MainLayout />
        </div>
        <ZoomIndicator />
        <ToastContainer />

        {showUpdateDialog && updateInfo && (
          <Suspense fallback={null}>
            <UpdateDialog
              updateInfo={updateInfo}
              downloadProgress={downloadProgress}
              downloading={downloading}
              installing={installing}
              error={updateError}
              onDownload={downloadUpdate}
              onDismiss={dismissUpdate}
            />
          </Suspense>
        )}
      </div>
    </>
  );
}

export default App;
