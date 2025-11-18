import { useEffect } from "react";
import KeybindingBadge from "@/ui/keybinding-badge";
import { cn } from "@/utils/cn";
import { useKeybindingRecorder } from "../hooks/use-keybinding-recorder";

interface KeybindingInputProps {
  value?: string;
  onSave: (keybinding: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}

export function KeybindingInput({
  value,
  onSave,
  onCancel,
  autoFocus = true,
}: KeybindingInputProps) {
  const { isRecording, keys, keybindingString, startRecording, stopRecording, reset } =
    useKeybindingRecorder();

  useEffect(() => {
    if (autoFocus) {
      startRecording();
    }
  }, [autoFocus, startRecording]);

  useEffect(() => {
    if (!isRecording && keybindingString) {
      onSave(keybindingString);
      reset();
    }
  }, [isRecording, keybindingString, onSave, reset]);

  const handleClick = () => {
    if (!isRecording) {
      startRecording();
    }
  };

  const handleCancel = () => {
    stopRecording();
    reset();
    onCancel();
  };

  return (
    <div
      className={cn(
        "flex h-7 items-center justify-between gap-2 rounded border px-2",
        isRecording ? "border-accent bg-accent/5" : "border-border bg-secondary-bg",
      )}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          handleCancel();
        }
      }}
      role="textbox"
      aria-label="Record keybinding"
      tabIndex={0}
    >
      {keys.length > 0 ? (
        <KeybindingBadge keys={keys} />
      ) : (
        <span className="text-xs text-text-lighter">
          {isRecording ? "Press keys..." : value || "Not assigned"}
        </span>
      )}
      {isRecording && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCancel();
          }}
          className="text-xs text-text-lighter hover:text-text"
          aria-label="Cancel recording"
        >
          Esc to cancel
        </button>
      )}
    </div>
  );
}
