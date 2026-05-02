import { Microphone as Mic, PaperPlaneTilt as Send } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContextSelector } from "@/features/ai/components/selectors/context-selector";
import { AgentSelector } from "@/features/ai/components/selectors/agent-selector";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentType } from "@/features/ai/types/ai-chat";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";
import Command from "@/ui/command";
import { cn } from "@/utils/cn";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { isMac } from "@/utils/platform";

export function AgentLauncher() {
  const launcherRef = useRef<HTMLDivElement>(null);
  const isVisible = useUIState((state) => state.isAgentLauncherVisible);
  const setIsVisible = useUIState((state) => state.setIsAgentLauncherVisible);
  const buffers = useBufferStore.use.buffers();
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const setPendingAgentLaunchRequest = useAIChatStore(
    (state) => state.setPendingAgentLaunchRequest,
  );
  const setSelectedBufferIds = useAIChatStore((state) => state.setSelectedBufferIds);
  const setSelectedFilesPaths = useAIChatStore((state) => state.setSelectedFilesPaths);

  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const keepListeningRef = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentType>(getCurrentAgentId());
  const [selectedBufferIds, setLocalSelectedBufferIds] = useState<Set<string>>(new Set());
  const [selectedFilesPaths, setLocalSelectedFilesPaths] = useState<Set<string>>(new Set());
  const speechPrefixRef = useRef("");

  const speechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isSpeechRecognitionSupported =
    !(import.meta.env.DEV && isMac()) && typeof speechRecognitionCtor !== "undefined";

  const selectedContextCount = selectedBufferIds.size + selectedFilesPaths.size;
  const resetState = useCallback(() => {
    setPrompt("");
    setContextOpen(false);
    setSelectedAgentId(getCurrentAgentId());
    setLocalSelectedBufferIds(new Set());
    setLocalSelectedFilesPaths(new Set());
    keepListeningRef.current = false;
    recognitionRef.current?.stop();
    setIsListening(false);
    speechPrefixRef.current = "";
  }, [getCurrentAgentId]);

  const close = useCallback(() => {
    setIsVisible(false);
    resetState();
  }, [resetState, setIsVisible]);

  useEffect(() => {
    if (!isVisible) return;

    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !isSpeechRecognitionSupported) return;

    const recognition = new speechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0]?.transcript || "";
      }

      const nextTranscript = transcript.trim();
      setPrompt(
        nextTranscript.length > 0
          ? `${speechPrefixRef.current}${nextTranscript}`.trim()
          : speechPrefixRef.current.trim(),
      );
    };

    recognition.onend = () => {
      if (keepListeningRef.current) {
        recognition.start();
        return;
      }
      setIsListening(false);
    };

    recognition.onerror = () => {
      keepListeningRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      keepListeningRef.current = false;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [isSpeechRecognitionSupported, isVisible, speechRecognitionCtor]);

  const toggleVoiceInput = useCallback(() => {
    if (!recognitionRef.current || !isSpeechRecognitionSupported) {
      return;
    }

    if (isListening) {
      keepListeningRef.current = false;
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    speechPrefixRef.current = prompt.trim();
    keepListeningRef.current = true;
    recognitionRef.current.start();
    setIsListening(true);
  }, [isListening, isSpeechRecognitionSupported, prompt]);

  const submit = useCallback(() => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt) return;

    const chatId = createNewChat(selectedAgentId);
    setSelectedBufferIds(new Set(selectedBufferIds));
    setSelectedFilesPaths(new Set(selectedFilesPaths));
    setPendingAgentLaunchRequest({
      chatId,
      agentId: selectedAgentId,
      prompt: nextPrompt,
      selectedBufferIds: Array.from(selectedBufferIds),
      selectedFilesPaths: Array.from(selectedFilesPaths),
    });
    openAgentBuffer(chatId);
    close();
  }, [
    close,
    createNewChat,
    openAgentBuffer,
    prompt,
    selectedAgentId,
    selectedBufferIds,
    selectedFilesPaths,
    setPendingAgentLaunchRequest,
    setSelectedBufferIds,
    setSelectedFilesPaths,
  ]);

  const selectableBuffers = useMemo(
    () => buffers.filter((buffer) => buffer.type !== "agent"),
    [buffers],
  );

  return (
    <Command
      isVisible={isVisible}
      onClose={close}
      placement="bottom"
      className="w-[min(820px,calc(100vw-32px))] overflow-visible rounded-[14px] border border-border/70 bg-primary-bg/96 p-2 shadow-[0_34px_110px_-48px_rgba(0,0,0,0.72)]"
    >
      <div ref={launcherRef} className="flex items-center gap-1.5 rounded-[10px] px-1 py-1">
        <div className="flex shrink-0 items-center gap-1">
          <ContextSelector
            buffers={selectableBuffers}
            selectedBufferIds={selectedBufferIds}
            selectedFilesPaths={selectedFilesPaths}
            onToggleBuffer={(bufferId) =>
              setLocalSelectedBufferIds((current) => {
                const next = new Set(current);
                if (next.has(bufferId)) {
                  next.delete(bufferId);
                } else {
                  next.add(bufferId);
                }
                return next;
              })
            }
            onToggleFile={(filePath) =>
              setLocalSelectedFilesPaths((current) => {
                const next = new Set(current);
                if (next.has(filePath)) {
                  next.delete(filePath);
                } else {
                  next.add(filePath);
                }
                return next;
              })
            }
            isOpen={contextOpen}
            onToggleOpen={() => setContextOpen((open) => !open)}
          />
          {selectedContextCount > 0 && (
            <span className="ui-font ui-text-xs rounded-full bg-accent/12 px-1.5 py-0.5 text-accent">
              {selectedContextCount}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask an agent to do something..."
            className="ui-font ui-text-sm h-9 w-full bg-transparent px-1 text-text outline-none placeholder:text-text-lighter"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <AgentSelector
            variant="input"
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
            portalContainer={launcherRef.current}
          />
          <Button
            type="button"
            onClick={toggleVoiceInput}
            disabled={!isSpeechRecognitionSupported}
            variant="ghost"
            size="icon-xs"
            className={cn(
              "rounded-full text-text-lighter hover:text-text",
              isListening && "bg-accent/12 text-accent",
            )}
            tooltip={
              !isSpeechRecognitionSupported
                ? "Voice input is not supported"
                : isListening
                  ? "Stop voice input"
                  : "Start voice input"
            }
            aria-label={isListening ? "Stop voice input" : "Start voice input"}
          >
            <Mic className={cn("size-3.5", isListening && "animate-pulse")} />
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!prompt.trim()}
            variant="secondary"
            size="xs"
            className="rounded-full px-2.5"
            tooltip="Launch agent"
            shortcut="enter"
            aria-label="Launch agent"
          >
            <Send className="size-3.5" />
          </Button>
        </div>
      </div>
    </Command>
  );
}
