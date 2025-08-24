import { relaunch } from "@tauri-apps/plugin-process";
import Button from "@/components/ui/button";
import Dialog from "@/components/ui/dialog";

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
    <Dialog
      onClose={onClose}
      title="Restart Editor?"
      classNames={{
        backdrop: "z-[9999]",
        modal: "h-[180px] w-[300px]",
        content: "flex-col justify-between p-4",
      }}
    >
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
    </Dialog>
  );
};

export default RestartDialog;
