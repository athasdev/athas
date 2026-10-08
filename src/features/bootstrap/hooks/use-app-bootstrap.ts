import { useEffect } from "react";
import { commands } from "@/bindings/commands";
import { useExtensionInstallPrompt } from "@/extensions/hooks/use-extension-install-prompt";
import {
  cleanupAcpBufferReads,
  initializeAcpBufferReads,
} from "@/features/ai/services/acp-buffer-reads";
import {
  cleanupFileClipboardListener,
  initializeFileClipboardListener,
} from "@/features/file-explorer/services/file-explorer-clipboard-listener";
import {
  cleanupFileWatcherListener,
  initializeFileWatcherListener,
} from "@/features/file-system/services/file-watcher-listener";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding.store";
import { useLspInitialization } from "@/features/editor/hooks/use-lsp-initialization";
import { useKeymapContext } from "@/features/keymaps/hooks/use-keymap-context";
import { useKeymaps } from "@/features/keymaps/hooks/use-keymaps";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { useCliOpen } from "@/features/window/hooks/use-cli-open";
import { useContextMenuPrevention } from "@/features/bootstrap/hooks/use-context-menu-prevention";
import { useDeepLink } from "@/features/window/hooks/use-deep-link";
import { useExternalNavigationGuard } from "@/features/window/hooks/use-external-navigation-guard";
import { usePlatformSetup } from "@/features/bootstrap/hooks/use-platform-setup";
import { useWindowDocumentState } from "@/features/window/hooks/use-window-document-state";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import {
  enqueueWindowOpenRequest,
  parseWindowOpenUrl,
} from "@/features/window/services/window-open-request";

export function useAppBootstrap() {
  const initializeWhatsNew = useWhatsNewStore((state) => state.actions.initialize);
  const initializeOnboarding = useOnboardingStore((state) => state.actions.initialize);

  usePlatformSetup();
  useWindowDocumentState();
  useDeepLink();
  useCliOpen();
  useExternalNavigationGuard();
  useExtensionInstallPrompt();
  useKeymapContext();
  useKeymaps();
  useContextMenuPrevention();
  useLspInitialization();

  useEffect(() => {
    let timer: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        void commands.warmTerminalEnvironment().catch((error) => {
          console.warn("Failed to warm terminal environment:", error);
        });
      }, 0);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    void import("@/features/browser/services/browser-tab-manager").then(({ browserTabManager }) =>
      browserTabManager.cleanupStaleTabs(),
    );
  }, []);

  useEffect(() => {
    void useAuthStore.getState().actions.initialize();
  }, []);

  useEffect(() => {
    void initializeWhatsNew();
  }, [initializeWhatsNew]);

  useEffect(() => {
    void initializeOnboarding();
  }, [initializeOnboarding]);

  useEffect(() => {
    void initializeFileWatcherListener();

    return () => {
      void cleanupFileWatcherListener();
    };
  }, []);

  useEffect(() => {
    void initializeAcpBufferReads();

    return () => {
      void cleanupAcpBufferReads();
    };
  }, []);

  useEffect(() => {
    void initializeFileClipboardListener();

    return () => {
      void cleanupFileClipboardListener();
    };
  }, []);

  useEffect(() => {
    const request = parseWindowOpenUrl(new URL(window.location.href));
    if (!request) return;

    void enqueueWindowOpenRequest(request);

    const nextUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl || "/");
  }, []);
}
