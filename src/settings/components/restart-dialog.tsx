import { relaunch } from "@tauri-apps/plugin-process";
import { X } from "lucide-react";
import Button from "@/components/ui/button";
import { cn } from "@/utils/cn";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const RestartDialog = ({ isOpen, onClose }: SettingsDialogProps) => {
  const handleRestart = async () => {
    onClose();
    await relaunch();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[9999] bg-black/20" onClick={onClose} />

      {/* Modal */}
      <div
        className={cn(
          "-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[10000] transform",
          "h-[180px] w-[300px] overflow-hidden",
          "rounded-lg border border-border bg-primary-bg shadow-xl",
          "flex flex-col",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b px-4 py-3">
          <h2 className="font-medium text-text">Restart Editor?</h2>
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-hover"
          >
            <X size={14} className="text-text-lighter" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col justify-between p-4">
          <p className="text-text-light text-xs leading-relaxed">
            A setting has been changed that requires restarting the editor to take effect.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Later
            </Button>
            <Button onClick={handleRestart} className="bg-blue-500 text-white hover:bg-blue-600">
              Restart
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default RestartDialog;
