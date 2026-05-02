import { useCallback, useEffect, useState } from "react";
import { keybindingToDisplay } from "@/utils/keybinding-display";
import { normalizeKey } from "@/utils/platform";
import { useKeymapStore } from "../stores/store";
import { eventToKey } from "../utils/matcher";

interface RecorderState {
  keys: string[];
  keybindingString: string;
}

export function useKeybindingRecorder(commandId: string) {
  const [state, setState] = useState<RecorderState>({
    keys: [],
    keybindingString: "",
  });

  const recordingCommandId = useKeymapStore.use.recordingCommandId();
  const { startRecording: storeStartRecording, stopRecording: storeStopRecording } =
    useKeymapStore.use.actions();

  const isRecording = recordingCommandId === commandId;

  const startRecording = useCallback(() => {
    storeStartRecording(commandId);
    setState({ keys: [], keybindingString: "" });
  }, [commandId, storeStartRecording]);

  const stopRecording = useCallback(() => {
    storeStopRecording();
  }, [storeStopRecording]);

  const reset = useCallback(() => {
    storeStopRecording();
    setState({ keys: [], keybindingString: "" });
  }, [storeStopRecording]);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        stopRecording();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        stopRecording();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Use the same key parsing as the matcher for consistency
      const parsedKey = eventToKey(e);
      const combination = [...parsedKey.modifiers, parsedKey.key.toLowerCase()].join("+");
      const normalized = normalizeKey(combination);

      setState({
        keys: keybindingToDisplay(normalized),
        keybindingString: normalized,
      });
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isRecording, stopRecording]);

  return {
    isRecording,
    keys: state.keys,
    keybindingString: state.keybindingString,
    startRecording,
    stopRecording,
    reset,
  };
}
