import { X } from "lucide-react";
import { useUIExtensionStore } from "../stores/ui-extension-store";
import { ExtensionErrorBoundary } from "./extension-error-boundary";
import { Button } from "@/ui/button";

export function ExtensionDialogs() {
  const activeDialogs = useUIExtensionStore.use.activeDialogs();
  const closeDialog = useUIExtensionStore.use.closeDialog();

  if (activeDialogs.length === 0) return null;

  return (
    <>
      {activeDialogs.map((dialog) => (
        <div
          key={dialog.id}
          className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50"
          role="dialog"
          aria-label={dialog.title}
        >
          <div
            className="flex flex-col overflow-hidden rounded-xl border border-border bg-primary-bg shadow-2xl"
            style={{
              width: dialog.width ?? 480,
              maxHeight: dialog.height ?? 600,
            }}
          >
            <div className="flex items-center justify-between border-border border-b px-4 py-3">
              <h2 className="font-medium text-sm text-text">{dialog.title}</h2>
              <Button
                onClick={() => closeDialog(dialog.id)}
                variant="ghost"
                size="icon-xs"
                aria-label="Close dialog"
              >
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <ExtensionErrorBoundary extensionId={dialog.extensionId} name={dialog.title}>
                {dialog.render()}
              </ExtensionErrorBoundary>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
