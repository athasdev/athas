import { lazy, Suspense } from "react";
import { useUIState } from "@/features/window/stores/ui-state.store";
import AppDialog from "@/ui/dialog";

const SettingsWorkbenchView = lazy(() => import("./settings-workbench-view"));

export function SettingsDialog() {
  const isSettingsVisible = useUIState((state) => state.isSettingsVisible);
  const closeSettings = useUIState((state) => state.closeSettings);

  if (!isSettingsVisible) return null;

  return (
    <AppDialog
      title="Settings"
      size="settings"
      hideHeader
      scrollable={false}
      onClose={closeSettings}
    >
      <Suspense fallback={null}>
        <SettingsWorkbenchView onClose={closeSettings} />
      </Suspense>
    </AppDialog>
  );
}
