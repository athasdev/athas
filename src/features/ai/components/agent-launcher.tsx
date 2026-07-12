import { MicrophoneIcon as Mic, PaperPlaneTiltIcon as Send } from "@/ui/icons";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ContextSelector } from "@/features/ai/components/selectors/context-selector";
import { AgentSelector } from "@/features/ai/components/selectors/agent-selector";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Command from "@/ui/command";
import { cn } from "@/utils/cn";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { isMac } from "@/utils/platform";
import { CLAUDE_CODE_TERMINAL_AGENT_ID } from "@/features/ai/lib/claude-code";
import { openClaudeCodeTerminal } from "@/features/ai/lib/claude-code-terminal";

interface AgentLaunchInputProps {
  active?: boolean;
  autoFocus?: boolean;
  className?: string;
  onRequestClose?: () => void;
  variant?: "compact" | "hero";
}

export function AgentLaunchInput({
  active = true,
  autoFocus = false,
  className,
  onRequestClose,
  variant = "compact",
}: AgentLaunchInputProps) {
  const launcherRef = useRef<HTMLDivElement>(null);
  const selectableBuffers = useBufferStore((state) =>
    active ? state.buffers.filter((buffer) => buffer.type !== "agent") : [],
  );
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const setPendingAgentLaunchRequest = useAIChatStore(
    (state) => state.setPendingAgentLaunchRequest,
  );
  const setSelectedBufferIds = useAIChatStore((state) => state.setSelectedBufferIds);
  const setSelectedFilesPaths = useAIChatStore((state) => state.setSelectedFilesPaths);

  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const isHero = variant === "hero";

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
    onRequestClose?.();
    resetState();
  }, [onRequestClose, resetState]);

  useEffect(() => {
    if (!active) {
      resetState();
      return;
    }

    if (!autoFocus) return;
    const id = window.requestAnimationFrame(() => {
      const target = isHero ? textareaRef.current : inputRef.current;
      target?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [active, autoFocus, isHero, resetState]);

  useEffect(() => {
    if (!active || !isSpeechRecognitionSupported) return;

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
  }, [active, isSpeechRecognitionSupported, speechRecognitionCtor]);

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
    if (selectedAgentId === CLAUDE_CODE_TERMINAL_AGENT_ID) {
      openClaudeCodeTerminal();
      close();
      return;
    }

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

  const handlePromptKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key === "Enter" && (!isHero || !event.shiftKey)) {
        event.preventDefault();
        submit();
      }
    },
    [close, isHero, submit],
  );

  const contextControl = (
    <div className="flex min-w-0 shrink-0 items-center gap-1">
      <ContextSelector
        buffers={selectableBuffers}
        selectedBufferIds={selectedBufferIds}
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
        <Badge variant="accent" size="compact">
          {selectedContextCount}
        </Badge>
      )}
    </div>
  );

  const agentControls = (
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
        size="icon-xs"
      >
        <Mic className={cn("size-3.5", isListening && "animate-pulse")} />
      </Button>
      <Button
        type="button"
        onClick={submit}
        disabled={selectedAgentId !== CLAUDE_CODE_TERMINAL_AGENT_ID && !prompt.trim()}
        variant="default"
        className="rounded-full"
        tooltip="Launch agent"
        shortcut="enter"
        aria-label="Launch agent"
        size="icon-xs"
      >
        <Send className="size-3.5" />
      </Button>
    </div>
  );

  if (isHero) {
    return (
      <div ref={launcherRef} className={cn("flex flex-col", className)}>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder="Ask anything..."
          className="font-sans ui-text-base min-h-16 w-full resize-none bg-transparent px-1 py-1 text-text leading-6 outline-none placeholder:text-text-lighter"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="mt-2 flex min-w-0 items-center justify-between gap-2 border-border/45 border-t pt-2">
          {contextControl}
          {agentControls}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={launcherRef}
      className={cn("flex items-center gap-1.5 rounded-[10px] px-1 py-1", className)}
    >
      {contextControl}

      <div className="min-w-0 flex-1">
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder="Ask an agent to do something..."
          className="font-sans ui-text-base h-9 w-full bg-transparent px-1 text-text outline-none placeholder:text-text-lighter"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {agentControls}
    </div>
  );
}

export function AgentLauncher() {
  const isVisible = useUIState((state) => state.isAgentLauncherVisible);
  const setIsVisible = useUIState((state) => state.setIsAgentLauncherVisible);
  const close = useCallback(() => setIsVisible(false), [setIsVisible]);

  return (
    <Command
      isVisible={isVisible}
      onClose={close}
      className="w-[min(820px,calc(100vw-32px))] overflow-visible rounded-[14px] border border-border/70 bg-primary-bg/96 p-2 shadow-[0_34px_110px_-48px_rgba(0,0,0,0.72)]"
    >
      <AgentLaunchInput active={isVisible} autoFocus onRequestClose={close} />
    </Command>
  );
}
