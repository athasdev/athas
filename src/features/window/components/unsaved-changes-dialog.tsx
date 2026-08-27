import { WarningIcon as AlertTriangle } from "@/ui/icons";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { IS_MAC } from "@/utils/platform";

interface Props {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  fileName: string;
}

const UnsavedChangesDialog = ({ onSave, onDiscard, onCancel, fileName }: Props) => {
  const canUseNativeSheet =
    IS_MAC && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [nativeSheetFailed, setNativeSheetFailed] = useState(false);
  const requestedNativeSheet = useRef(false);

  useEffect(() => {
    if (!canUseNativeSheet || nativeSheetFailed || requestedNativeSheet.current) return;
    requestedNativeSheet.current = true;

    void invoke<string>("show_native_choice_sheet", {
      message: `Do you want to save the changes made to “${fileName}”?`,
      informativeText: "Your changes will be lost if you don’t save them.",
      primaryLabel: "Save",
      secondaryLabel: "Don’t Save",
      cancelLabel: "Cancel",
    })
      .then((choice) => {
        if (choice === "primary") onSave();
        else if (choice === "secondary") onDiscard();
        else onCancel();
      })
      .catch(() => {
        setNativeSheetFailed(true);
      });
  }, [canUseNativeSheet, fileName, nativeSheetFailed, onCancel, onDiscard, onSave]);

  if (canUseNativeSheet && !nativeSheetFailed) {
    return null;
  }

  return (
    <Dialog
      title="Unsaved Changes"
      icon={AlertTriangle}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button onClick={onDiscard}>Don't Save</Button>
          <Button onClick={onSave} variant="accent">
            Save
          </Button>
        </>
      }
    >
      <p className="text-foreground ui-text-sm">
        Do you want to save the changes you made to <strong>{fileName}</strong>?
      </p>
    </Dialog>
  );
};

export default UnsavedChangesDialog;
