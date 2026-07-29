import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IS_LINUX, isMac } from "@/utils/platform";

function getMicrophoneAccessErrorMessage(error?: string): string {
  if (IS_LINUX) {
    if (error === "service-not-allowed") {
      return "Voice input is unavailable in this Linux webview. Chromium speech recognition may be blocked even when the microphone works.";
    }

    return "Microphone access failed. Check your PipeWire/PulseAudio input device and unmute the default microphone.";
  }

  return "Microphone access failed. Check System Settings -> Privacy & Security -> Microphone.";
}

export function useVoiceInput({
  enabled,
  insertText,
  focusInput,
}: {
  enabled: boolean;
  insertText: (text: string) => void;
  focusInput: () => void;
}) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isMacDevBlocked = import.meta.env.DEV && isMac();
  const isSupported = !isMacDevBlocked && typeof SpeechRecognitionCtor !== "undefined";

  const stop = useCallback(() => {
    shouldKeepListeningRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const start = useCallback(async () => {
    if (!enabled) return;

    if (isMacDevBlocked) {
      toast.warning("Voice input is disabled in macOS dev mode. Test it in a packaged app build.");
      return;
    }

    if (!SpeechRecognitionCtor) {
      toast.warning("Voice input is not supported in this webview.");
      return;
    }

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        toast.error(getMicrophoneAccessErrorMessage());
        return;
      }
    }

    const recognition = new SpeechRecognitionCtor();
    recognitionRef.current = recognition;
    shouldKeepListeningRef.current = true;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (event) => {
      let committedTranscript = "";
      let nextInterimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index++) {
        const transcript = event.results[index][0]?.transcript?.trim();
        if (!transcript) continue;

        if (event.results[index].isFinal) {
          committedTranscript += `${transcript} `;
        } else {
          nextInterimTranscript = transcript;
        }
      }

      if (committedTranscript.trim()) {
        insertText(committedTranscript);
      }
      setInterimTranscript(nextInterimTranscript);
    };

    recognition.onerror = (event) => {
      const isExpectedAbort = event.error === "aborted" || event.error === "no-speech";
      setIsListening(false);
      setInterimTranscript("");

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldKeepListeningRef.current = false;
        toast.error(getMicrophoneAccessErrorMessage(event.error));
        return;
      }

      if (!isExpectedAbort) {
        shouldKeepListeningRef.current = false;
        toast.error("Voice input stopped unexpectedly.");
      }
    };

    recognition.onend = () => {
      if (shouldKeepListeningRef.current) {
        try {
          recognition.start();
          return;
        } catch {
          shouldKeepListeningRef.current = false;
        }
      }

      setIsListening(false);
      setInterimTranscript("");
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      setIsListening(true);
      setInterimTranscript("");
      focusInput();
    } catch {
      shouldKeepListeningRef.current = false;
      recognitionRef.current = null;
      toast.error("Voice input could not be started.");
    }
  }, [SpeechRecognitionCtor, enabled, focusInput, insertText, isMacDevBlocked]);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
      return;
    }

    void start();
  }, [isListening, start, stop]);

  useEffect(
    () => () => {
      shouldKeepListeningRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  return {
    interimTranscript,
    isListening,
    isMacDevBlocked,
    isSupported,
    toggle,
  };
}
