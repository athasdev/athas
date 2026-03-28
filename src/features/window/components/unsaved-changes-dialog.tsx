import { AlertTriangle } from "lucide-react";
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
          <Button onClick={onCancel} variant="outline" size="sm">
            Cancel
          </Button>
          <Button onClick={onDiscard} variant="outline" size="sm">
            Don't Save
          </Button>
          <Button onClick={onSave} variant="primary" size="sm">
            Save
          </Button>
        </>
      }
    >
      <p className="text-text text-xs">
        Do you want to save the changes you made to <strong>{fileName}</strong>?
      </p>
    </Dialog>
  );
};

export default UnsavedChangesDialog;
