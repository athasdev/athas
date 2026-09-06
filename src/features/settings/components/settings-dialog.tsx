import { lazy, Suspense } from "react";
import Dialog from "@/ui/dialog";
import { useUIState } from "@/features/window/stores/ui-state.store";
const SettingsWorkbenchView = lazy(() => import("./settings-workbench-view"));

export function SettingsDialog() {
  const visible = useUIState((state) => state.isSettingsDialogVisible);
  const close = useUIState((state) => state.setIsSettingsDialogVisible);
  if (!visible) return null;
  return (
    <Dialog title="Settings" size="settings" scrollable={false} onClose={() => close(false)}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-subtle-foreground ui-text-sm">
            Loading settings…
          </div>
        }
      >
        <SettingsWorkbenchView />
      </Suspense>
    </Dialog>
  );
}
