import { Check, ChevronDown } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChatActions, useChatState } from "@/features/ai/hooks/use-chat-store";
import type { ChatMode } from "@/features/ai/store/types";
import type { AIChatSurface, ChatScopeId } from "@/features/ai/types/ai-chat";
import { cn } from "@/utils/cn";

interface ChatModeSelectorProps {
  className?: string;
  surface?: AIChatSurface;
  scopeId?: ChatScopeId;
}

const FALLBACK_MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "plan", label: "Plan" },
];

export const ChatModeSelector = memo(function ChatModeSelector({
  className,
  scopeId,
}: ChatModeSelectorProps) {
  const chatState = useChatState(scopeId);
  const chatActions = useChatActions(scopeId);

  const currentAgentId = chatActions.getCurrentAgentId();
  const isAcpAgent = currentAgentId !== "custom";
  const hasDynamicModes = isAcpAgent;
  const shouldHideForAcp = isAcpAgent && chatState.sessionModeState.availableModes.length === 0;

  const modeOptions = useMemo(() => {
    if (hasDynamicModes) {
      return chatState.sessionModeState.availableModes.map((m) => ({
        id: m.id,
        label: m.name,
      }));
    }

    return FALLBACK_MODES;
  }, [chatState.sessionModeState.availableModes, hasDynamicModes]);

  const selectedModeId = useMemo(() => {
    if (hasDynamicModes) {
      return chatState.sessionModeState.currentModeId ?? modeOptions[0]?.id ?? null;
    }
    return chatState.mode;
  }, [chatState.mode, chatState.sessionModeState.currentModeId, hasDynamicModes, modeOptions]);

  const selectedModeLabel = useMemo(
    () => modeOptions.find((m) => m.id === selectedModeId)?.label ?? "Mode",
    [modeOptions, selectedModeId],
  );
  const isSelectorDisabled = hasDynamicModes && modeOptions.length === 0;

  useEffect(() => {
    console.info("[AI][ModeSelector] state", {
      agentId: currentAgentId,
      isAcpAgent,
      currentModeId: chatState.sessionModeState.currentModeId,
      availableModeIds: chatState.sessionModeState.availableModes.map((m) => m.id),
      visible: !shouldHideForAcp,
    });
  }, [
    chatState.sessionModeState.availableModes,
    chatState.sessionModeState.currentModeId,
    currentAgentId,
    isAcpAgent,
    shouldHideForAcp,
  ]);

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 248, maxHeight: 220 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const padding = 8;
    const gap = 6;
    const width = 248;
    const maxHeight = Math.min(220, window.innerHeight - padding * 2);
    const dropdownHeight = Math.min(dropdownRef.current?.offsetHeight ?? 176, maxHeight);

    const spaceAbove = rect.top - padding;
    const spaceBelow = window.innerHeight - rect.bottom - padding;

    // Prefer opening below when possible; otherwise open above tightly to the trigger.
    const top =
      spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove
        ? rect.bottom + gap
        : rect.top - dropdownHeight - gap;

    let left = rect.left;
    if (left + width > window.innerWidth - padding) {
      left = window.innerWidth - width - padding;
    }
    if (left < padding) {
      left = padding;
    }

    const clampedTop = Math.max(
      padding,
      Math.min(top, window.innerHeight - dropdownHeight - padding),
    );

    setPosition({
      top: clampedTop,
      left,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    updateDropdownPosition();
    const handleResize = () => updateDropdownPosition();
    const handleScroll = () => updateDropdownPosition();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [isOpen, updateDropdownPosition]);

  if (shouldHideForAcp) {
    return null;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!isSelectorDisabled) {
            setIsOpen((prev) => !prev);
          }
        }}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-2xl border border-border/70 bg-primary-bg/75 px-3 text-xs transition-colors",
          isSelectorDisabled
            ? "cursor-not-allowed text-text-lighter/70"
            : "text-text hover:bg-hover",
          className,
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-disabled={isSelectorDisabled}
        aria-label="Select chat mode"
      >
        <span className="font-medium">{selectedModeLabel}</span>
        <ChevronDown
          size={11}
          className={cn(
            "text-text-lighter transition-transform",
            isOpen && "rotate-180",
            isSelectorDisabled && "opacity-50",
          )}
        />
      </button>

      {isOpen &&
        !isSelectorDisabled &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[10040] overflow-hidden rounded-[24px] border border-border/70 bg-primary-bg/95 shadow-lg backdrop-blur-sm"
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
              maxHeight: `${position.maxHeight}px`,
            }}
            role="listbox"
            aria-label="Chat mode options"
          >
            <div className="border-border/70 border-b bg-secondary-bg/75 px-3 py-2 text-[10px] text-text-lighter uppercase tracking-[0.16em]">
              Response Mode
            </div>
            <div className="p-1.5">
              {modeOptions.map((modeOption) => {
                const isActive = selectedModeId === modeOption.id;

                return (
                  <button
                    key={modeOption.id}
                    type="button"
                    onClick={() => {
                      if (hasDynamicModes) {
                        console.info("[AI][ModeSelector] request ACP mode change", {
                          agentId: currentAgentId,
                          modeId: modeOption.id,
                        });
                        void chatActions.changeSessionMode(modeOption.id);
                      } else {
                        console.info("[AI][ModeSelector] set local mode", {
                          modeId: modeOption.id,
                        });
                        chatActions.setMode(modeOption.id as ChatMode);
                      }
                      setIsOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                      isActive ? "bg-selected text-text" : "text-text-lighter hover:bg-hover",
                    )}
                    role="option"
                    aria-selected={isActive}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-xs">{modeOption.label}</div>
                    </div>
                    {isActive && <Check size={12} className="shrink-0 text-success" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
});
