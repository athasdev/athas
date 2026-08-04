import { XIcon as X } from "@/ui/icons";
import { useUIExtensionStore } from "../stores/ui-extension-store";
import { ExtensionErrorBoundary } from "./extension-error-boundary";
import { Button } from "@/ui/button";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { ScrollArea } from "@/ui/scroll-area";

export function ExtensionDialogs() {
  const activeDialogs = useUIExtensionStore.use.activeDialogs();
  const closeDialog = useUIExtensionStore.use.actions().closeDialog;

  if (activeDialogs.length === 0) return null;

  return (
    <>
      {activeDialogs.map((dialog) => (
        <Dialog
          key={dialog.id}
          open
          onOpenChange={(open) => {
            if (!open) closeDialog(dialog.id);
          }}
        >
          <DialogContent
            aria-describedby={undefined}
            showCloseButton={false}
            className="max-w-[calc(100vw-2rem)]"
            style={{
              width: dialog.width ?? 480,
              maxHeight: dialog.height ?? 600,
            }}
          >
            <DialogHeader className="flex-row items-center justify-between gap-2 border-border border-b px-4 py-3">
              <DialogTitle>{dialog.title}</DialogTitle>
              <DialogClose
                render={<Button variant="ghost" size="icon-xs" aria-label="Close dialog" />}
              >
                <X />
              </DialogClose>
            </DialogHeader>
            <ScrollArea className="min-h-0 flex-1" contentClassName="p-4">
              <ExtensionErrorBoundary extensionId={dialog.extensionId} name={dialog.title}>
                {dialog.render()}
              </ExtensionErrorBoundary>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      ))}
    </>
  );
}
