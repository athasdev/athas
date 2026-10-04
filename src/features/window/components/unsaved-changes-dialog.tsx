import { WarningIcon } from "@/ui/icons";
import { useEffect, useRef, useState } from "react";
import { commands } from "@/bindings/commands";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { IS_MAC } from "@/utils/platform";

let nativeChoices: Promise<unknown> = Promise.resolve();

interface NativeChoiceOptions {
  message: string;
  informativeText: string;
  primaryLabel: string;
  secondaryLabel: string;
  cancelLabel: string;
}

function requestNativeChoice(options: NativeChoiceOptions, isCurrent: () => boolean) {
  const result = nativeChoices
    .catch(() => undefined)
    .then(() => {
      if (!isCurrent())
        throw new DOMException("This close decision is no longer active", "AbortError");
      return commands.showNativeChoiceSheet(
        options.message,
        options.informativeText,
        options.primaryLabel,
        options.secondaryLabel,
        options.cancelLabel,
      );
    });
  nativeChoices = result;
  return result;
}

interface Props {
  onSave: () => void | Promise<unknown>;
  onDiscard: () => void;
  onCancel: () => void;
  fileName: string;
  decisionKey?: unknown;
}

const UnsavedChangesDialog = ({
  onSave,
  onDiscard,
  onCancel,
  fileName,
  decisionKey = fileName,
}: Props) => {
  const canUseNativeSheet =
    IS_MAC && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [failedDecision, setFailedDecision] = useState<{ key: unknown } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const callbacks = useRef({ onSave, onDiscard, onCancel });
  callbacks.current = { onSave, onDiscard, onCancel };
  const nativeTask = useRef<{ key: unknown; promise: Promise<string> } | null>(null);
  const latestDecision = useRef(decisionKey);
  latestDecision.current = decisionKey;
  const mounted = useRef(false);
  const nativeSheetFailed = failedDecision?.key === decisionKey;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setIsSaving(false);
  }, [decisionKey]);

  const save = async () => {
    setIsSaving(true);
    try {
      await callbacks.current.onSave();
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!canUseNativeSheet || nativeSheetFailed) return;
    let current = true;
    if (!nativeTask.current || nativeTask.current.key !== decisionKey) {
      const previous = nativeTask.current?.promise;
      const promise = Promise.resolve(previous)
        .catch(() => undefined)
        .then(() => {
          if (!mounted.current || latestDecision.current !== decisionKey) {
            throw new DOMException("This close decision is no longer active", "AbortError");
          }
          return requestNativeChoice(
            {
              message: `Do you want to save the changes made to “${fileName}”?`,
              informativeText: "Your changes will be lost if you don’t save them.",
              primaryLabel: "Save",
              secondaryLabel: "Don’t Save",
              cancelLabel: "Cancel",
            },
            () => mounted.current && latestDecision.current === decisionKey,
          );
        });
      nativeTask.current = { key: decisionKey, promise };
    }
    void nativeTask.current.promise
      .then(async (choice) => {
        if (!current) return;
        if (choice === "primary") {
          setIsSaving(true);
          try {
            await callbacks.current.onSave();
          } finally {
            if (current) {
              setIsSaving(false);
              setFailedDecision({ key: decisionKey });
            }
          }
        } else if (choice === "secondary") callbacks.current.onDiscard();
        else callbacks.current.onCancel();
      })
      .catch(() => {
        if (current) setFailedDecision({ key: decisionKey });
      });
    return () => {
      current = false;
    };
  }, [canUseNativeSheet, decisionKey, fileName, nativeSheetFailed]);

  if (canUseNativeSheet && !nativeSheetFailed) {
    return null;
  }

  return (
    <Dialog
      title="Unsaved Changes"
      icon={WarningIcon}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button onClick={onDiscard} disabled={isSaving}>
            Don't Save
          </Button>
          <Button
            onClick={() => void save().catch(() => undefined)}
            variant="accent"
            disabled={isSaving}
          >
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
