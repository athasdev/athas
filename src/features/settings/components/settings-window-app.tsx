import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { initializeAppBootstrap } from "@/features/bootstrap/initialize-app-bootstrap";
import { FontStyleInjector } from "@/features/settings/components/font-style-injector";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import { useSystemAccessibility } from "@/features/settings/hooks/use-system-accessibility";
import { useFontLoading } from "@/features/window/hooks/use-font-loading";
import { usePlatformSetup } from "@/features/window/hooks/use-platform-setup";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { type SettingsTab, useUIState } from "@/features/window/stores/ui-state.store";
import { TooltipProvider } from "@/ui/tooltip";

function isSettingsTab(value: string | null): value is SettingsTab {
  return [
    "account",
    "general",
    "editor",
    "git",
    "appearance",
    "ai",
    "keyboard",
    "language",
    "collaboration",
    "enterprise",
    "advanced",
    "terminal",
    "file-explorer",
  ].includes(value ?? "");
}

export default function SettingsWindowApp() {
  usePlatformSetup();
  useFontLoading();
  useSystemAccessibility();
  const setSettingsInitialTab = useUIState((state) => state.setSettingsInitialTab);

  useEffect(() => {
    const initialTab = new URL(window.location.href).searchParams.get("tab");
    if (isSettingsTab(initialTab)) setSettingsInitialTab(initialTab);
    void initializeAppBootstrap();
    void useAuthStore.getState().actions.initialize();

    const unlisten = listen<string>("settings_navigate", (event) => {
      if (isSettingsTab(event.payload)) setSettingsInitialTab(event.payload);
    });
    return () => void unlisten.then((dispose) => dispose());
  }, [setSettingsInitialTab]);

  return (
    <TooltipProvider>
      <FontStyleInjector />
      <div className="h-dvh w-dvw overflow-hidden bg-background">
        <SettingsDialog
          isOpen
          presentation="window"
          onClose={() => void getCurrentWindow().close()}
        />
      </div>
    </TooltipProvider>
  );
}
