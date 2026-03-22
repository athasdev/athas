import { useEffect } from "react";
import { useExtensionInstallPrompt } from "@/extensions/hooks/use-extension-install-prompt";
import {
  cleanupFileClipboardListener,
  initializeFileClipboardListener,
} from "@/features/file-explorer/stores/file-explorer-clipboard-listener";
import {
  cleanupFileWatcherListener,
  initializeFileWatcherListener,
} from "@/features/file-system/controllers/file-watcher-store";
import { useLspInitialization } from "@/features/editor/hooks/use-lsp-initialization";
import { useKeymapContext } from "@/features/keymaps/hooks/use-keymap-context";
import { useKeymaps } from "@/features/keymaps/hooks/use-keymaps";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new-store";
import { useCliOpen } from "@/features/window/hooks/use-cli-open";
import { useContextMenuPrevention } from "@/features/window/hooks/use-context-menu-prevention";
import { useDeepLink } from "@/features/window/hooks/use-deep-link";
import { useFontLoading } from "@/features/window/hooks/use-font-loading";
import { usePlatformSetup } from "@/features/window/hooks/use-platform-setup";
import { useAuthStore } from "@/features/window/stores/auth-store";

export function useAppBootstrap() {
  const initializeWhatsNew = useWhatsNewStore((state) => state.initialize);

  usePlatformSetup();
  useFontLoading();
  useDeepLink();
  useCliOpen();
  useExtensionInstallPrompt();
  useKeymapContext();
  useKeymaps();
  useContextMenuPrevention();
  useLspInitialization();

  useEffect(() => {
    void useAuthStore.getState().initialize();
  }, []);

  useEffect(() => {
    void initializeWhatsNew();
  }, [initializeWhatsNew]);

  useEffect(() => {
    void initializeFileWatcherListener();

    return () => {
      void cleanupFileWatcherListener();
    };
  }, []);

  useEffect(() => {
    void initializeFileClipboardListener();

    return () => {
      void cleanupFileClipboardListener();
    };
  }, []);
}
