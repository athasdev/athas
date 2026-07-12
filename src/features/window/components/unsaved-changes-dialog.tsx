import { WarningIcon as AlertTriangle } from "@/ui/icons";
import { useEffect } from "react";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";

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
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} compact>
            Cancel
          </Button>
          <Button onClick={onDiscard} compact>
            Don't Save
          </Button>
          <Button onClick={onSave} variant="accent" compact>
            Save
          </Button>
        </>
      }
    >
      <p className="text-text ui-text-sm">
        Do you want to save the changes you made to <strong>{fileName}</strong>?
      </p>
    </Dialog>
  );
};

export default UnsavedChangesDialog;
