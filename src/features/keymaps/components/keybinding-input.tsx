import { useEffect } from "react";
import KeybindingBadge from "@/ui/keybinding-badge";
import { cn } from "@/utils/cn";
import { useKeybindingRecorder } from "../hooks/use-keybinding-recorder";

interface KeybindingInputProps {
  commandId: string;
  value?: string;
  onSave: (keybinding: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}

export function KeybindingInput({
  commandId,
  value,
  onSave,
  onCancel,
  autoFocus = true,
}: KeybindingInputProps) {
  const { isRecording, keys, keybindingString, startRecording, stopRecording, reset } =
    useKeybindingRecorder(commandId);

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
        "flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded border px-2",
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
      <div className="min-w-0 flex-1 truncate">
        {keys.length > 0 ? (
          <KeybindingBadge keys={keys} />
        ) : (
          <span className="text-[10px] text-text-lighter">
            {isRecording ? "Press keys..." : value || "Not assigned"}
          </span>
        )}
      </div>
      {isRecording && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCancel();
          }}
          className="flex-shrink-0 text-[10px] text-text-lighter hover:text-text"
          aria-label="Cancel recording"
        >
          ESC
        </button>
      )}
    </div>
  );
}
