import { Check, ChevronDown } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode } from "@/features/ai/store/types";
import { Dropdown, dropdownItemClassName } from "@/ui/dropdown";
import { cn } from "@/utils/cn";

interface ChatModeSelectorProps {
  className?: string;
}

const FALLBACK_MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "plan", label: "Plan" },
];

export const ChatModeSelector = memo(function ChatModeSelector({
  className,
}: ChatModeSelectorProps) {
  const mode = useAIChatStore((state) => state.mode);
  const setMode = useAIChatStore((state) => state.setMode);
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const sessionModeState = useAIChatStore((state) => state.sessionModeState);
  const changeSessionMode = useAIChatStore((state) => state.changeSessionMode);

  const currentAgentId = getCurrentAgentId();
  const isAcpAgent = currentAgentId !== "custom";
  const hasDynamicModes = isAcpAgent;
  const shouldHideForAcp = isAcpAgent && sessionModeState.availableModes.length === 0;

  const modeOptions = useMemo(() => {
    if (hasDynamicModes) {
      return sessionModeState.availableModes.map((m) => ({
        id: m.id,
        label: m.name,
      }));
    }

    return FALLBACK_MODES;
  }, [hasDynamicModes, sessionModeState.availableModes]);

  const selectedModeId = useMemo(() => {
    if (hasDynamicModes) {
      return sessionModeState.currentModeId ?? modeOptions[0]?.id ?? null;
    }
    return mode;
  }, [hasDynamicModes, sessionModeState.currentModeId, modeOptions, mode]);

  const selectedModeLabel = useMemo(
    () => modeOptions.find((m) => m.id === selectedModeId)?.label ?? "Mode",
    [modeOptions, selectedModeId],
  );
  const isSelectorDisabled = hasDynamicModes && modeOptions.length === 0;

  useEffect(() => {
    console.info("[AI][ModeSelector] state", {
      agentId: currentAgentId,
      isAcpAgent,
      currentModeId: sessionModeState.currentModeId,
      availableModeIds: sessionModeState.availableModes.map((m) => m.id),
      visible: !shouldHideForAcp,
    });
  }, [
    currentAgentId,
    isAcpAgent,
    sessionModeState.currentModeId,
    sessionModeState.availableModes,
    shouldHideForAcp,
  ]);

  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
          "inline-flex items-center gap-1 px-1 text-xs transition-colors",
          isSelectorDisabled
            ? "cursor-not-allowed text-text-lighter/70"
            : "text-text-lighter hover:text-text",
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

      <Dropdown
        isOpen={isOpen && !isSelectorDisabled}
        anchorRef={triggerRef}
        onClose={() => setIsOpen(false)}
        className="w-[248px] overflow-hidden rounded-2xl p-0"
      >
        <div className="border-border/70 border-b bg-secondary-bg/75 px-3 py-2 text-[10px] text-text-lighter uppercase tracking-wide">
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
                    void changeSessionMode(modeOption.id);
                  } else {
                    console.info("[AI][ModeSelector] set local mode", {
                      modeId: modeOption.id,
                    });
                    setMode(modeOption.id as ChatMode);
                  }
                  setIsOpen(false);
                }}
                className={cn(
                  dropdownItemClassName(),
                  isActive ? "bg-selected text-text" : "text-text-lighter",
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
      </Dropdown>
    </>
  );
});
