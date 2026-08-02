import { PaperPlaneTiltIcon as Send } from "@/ui/icons";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AgentSelector } from "@/features/ai/components/selectors/agent-selector";
import { CLAUDE_CODE_TERMINAL_AGENT_ID } from "@/features/ai/lib/claude-code";
import { openClaudeCodeTerminal } from "@/features/ai/lib/claude-code-terminal";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import Command from "@/ui/command";
import { cn } from "@/utils/cn";

interface AgentLaunchInputProps {
  active?: boolean;
  autoFocus?: boolean;
  className?: string;
  onRequestClose?: () => void;
}

export function AgentLaunchInput({
  active = true,
  autoFocus = false,
  className,
  onRequestClose,
}: AgentLaunchInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const createNewChat = useAIChatStore((state) => state.actions.createNewChat);
  const getCurrentAgentId = useAIChatStore((state) => state.actions.getCurrentAgentId);
  const setPendingAgentLaunchRequest = useAIChatStore(
    (state) => state.actions.setPendingAgentLaunchRequest,
  );
  const [prompt, setPrompt] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<AgentType>(getCurrentAgentId());

  const reset = useCallback(() => {
    setPrompt("");
    setSelectedAgentId(getCurrentAgentId());
  }, [getCurrentAgentId]);

  const close = useCallback(() => {
    onRequestClose?.();
    reset();
  }, [onRequestClose, reset]);

  useEffect(() => {
    if (!active) {
      reset();
      return;
    }
    if (!autoFocus) return;

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [active, autoFocus, reset]);

  const submit = useCallback(() => {
    if (selectedAgentId === CLAUDE_CODE_TERMINAL_AGENT_ID) {
      openClaudeCodeTerminal();
      close();
      return;
    }

    const nextPrompt = prompt.trim();
    if (!nextPrompt) return;

    const chatId = createNewChat(selectedAgentId, { activate: false });
    setPendingAgentLaunchRequest({
      chatId,
      agentId: selectedAgentId,
      prompt: nextPrompt,
      selectedBufferIds: [],
      selectedFilesPaths: [],
    });
    openAgentBuffer(chatId);
    close();
  }, [
    close,
    createNewChat,
    openAgentBuffer,
    prompt,
    selectedAgentId,
    setPendingAgentLaunchRequest,
  ]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    },
    [close, submit],
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex w-full items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-sm",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="text"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What should the agent do?"
        className="font-sans ui-text-base h-8 min-w-0 flex-1 bg-transparent px-2 text-foreground outline-none placeholder:text-subtle-foreground"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <AgentSelector
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        portalContainer={rootRef.current}
      />
      <Button
        type="button"
        onClick={submit}
        disabled={selectedAgentId !== CLAUDE_CODE_TERMINAL_AGENT_ID && !prompt.trim()}
        variant="default"
        size="icon-sm"
        tooltip="Start agent"
        shortcut="enter"
        aria-label="Start agent"
      >
        <Send />
      </Button>
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
      className="w-[min(680px,calc(100vw-24px))] overflow-visible border-0 bg-transparent p-0 shadow-none"
    >
      <AgentLaunchInput active={isVisible} autoFocus onRequestClose={close} />
    </Command>
  );
}
