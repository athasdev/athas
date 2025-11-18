import { useCallback, useEffect, useState } from "react";
import { normalizeKey } from "../utils/platform";

interface RecorderState {
  isRecording: boolean;
  keys: string[];
  keybindingString: string;
}

export function useKeybindingRecorder() {
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    keys: [],
    keybindingString: "",
  });

  const startRecording = useCallback(() => {
    setState({
      isRecording: true,
      keys: [],
      keybindingString: "",
    });
  }, []);

  const stopRecording = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isRecording: false,
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      isRecording: false,
      keys: [],
      keybindingString: "",
    });
  }, []);

  useEffect(() => {
    if (!state.isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore bare modifier keys
      if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
        return;
      }

      // Escape cancels recording
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        stopRecording();
        return;
      }

      // Enter confirms recording
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        stopRecording();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("ctrl");
      if (e.metaKey) modifiers.push("cmd");
      if (e.altKey) modifiers.push("alt");
      if (e.shiftKey) modifiers.push("shift");

      const key = e.key.toLowerCase();

      const combination = [...modifiers, key].join("+");
      const normalized = normalizeKey(combination);

      setState((prev) => ({
        ...prev,
        keys: [...modifiers.map((m) => m.charAt(0).toUpperCase() + m.slice(1)), key.toUpperCase()],
        keybindingString: normalized,
      }));
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [state.isRecording, stopRecording]);

  return {
    isRecording: state.isRecording,
    keys: state.keys,
    keybindingString: state.keybindingString,
    startRecording,
    stopRecording,
    reset,
  };
}
