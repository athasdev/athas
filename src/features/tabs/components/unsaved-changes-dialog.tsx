import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import Dialog from "@/components/ui/dialog";

interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  fileName: string;
}

const UnsavedChangesDialog = ({ onSave, onDiscard, onCancel, fileName }: Props) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <Dialog
      title="Unsaved Changes"
      icon={AlertTriangle}
      onClose={onCancel}
      classNames={{
        modal: "w-[380px]",
        content: "p-3",
      }}
    >
      <div className="flex flex-col gap-3">
        <p className="text-text text-xs">
          Do you want to save the changes you made to <strong>{fileName}</strong>?
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-border bg-primary-bg px-3 py-1 text-text text-xs transition-colors hover:bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="rounded border border-border bg-primary-bg px-3 py-1 text-text text-xs transition-colors hover:bg-hover"
          >
            Don't Save
          </button>
          <button
            onClick={onSave}
            className="rounded bg-accent px-3 py-1 text-white text-xs transition-colors hover:bg-accent-hover"
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default UnsavedChangesDialog;
