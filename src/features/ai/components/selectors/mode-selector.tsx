import { memo, useMemo } from "react";
import { FadersHorizontalIcon as FadersHorizontal } from "@/ui/icons";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ChatMode } from "@/features/ai/types/ai-chat-store.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import {
  chatComposerControlClassName,
  chatComposerIconButtonClassName,
} from "../input/chat-composer-control-styles";

interface ModeSelectorProps {
  className?: string;
  iconOnly?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  agentId?: AgentType;
}

const FALLBACK_MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Ask" },
  { id: "plan", label: "Plan" },
];

export const ModeSelector = memo(function ModeSelector({
  className,
  iconOnly = false,
  open,
  onOpenChange,
  agentId,
}: ModeSelectorProps) {
  const mode = useAIChatStore((state) => state.mode);
  const setMode = useAIChatStore((state) => state.setMode);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const chats = useAIChatStore((state) => state.chats);
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);
  const sessionModeState = useAIChatStore((state) => state.sessionModeState);
  const changeSessionMode = useAIChatStore((state) => state.changeSessionMode);

  const currentAgentId =
    agentId ?? chats.find((chat) => chat.id === currentChatId)?.agentId ?? selectedAgentId;
  const isAcpAgent = currentAgentId !== "custom";
  const hasDynamicModes = isAcpAgent;
  const shouldHideForAcp = isAcpAgent && sessionModeState.availableModes.length === 0;

  const modeOptions = useMemo(() => {
    if (hasDynamicModes) {
      return sessionModeState.availableModes.map((modeOption) => ({
        value: modeOption.id,
        label: modeOption.name,
      }));
    }

    return FALLBACK_MODES.map((modeOption) => ({
      value: modeOption.id,
      label: modeOption.label,
    }));
  }, [hasDynamicModes, sessionModeState.availableModes]);

  const selectedModeId = useMemo(() => {
    if (hasDynamicModes) {
      return sessionModeState.currentModeId ?? modeOptions[0]?.value ?? "";
    }

    return mode;
  }, [hasDynamicModes, sessionModeState.currentModeId, modeOptions, mode]);

  const isSelectorDisabled = hasDynamicModes && modeOptions.length === 0;

  if (shouldHideForAcp) {
    return null;
  }

  return (
    <Select
      value={selectedModeId}
      options={modeOptions}
      onChange={(value) => {
        if (hasDynamicModes) {
          void changeSessionMode(value);
          return;
        }

        setMode(value as ChatMode);
      }}
      disabled={isSelectorDisabled}
      size="sm"
      openDirection="up"
      variant="ghost"
      open={open}
      onOpenChange={onOpenChange}
      leftIcon={iconOnly ? <FadersHorizontal size={13} className="text-current" /> : undefined}
      className={cn(iconOnly ? "w-fit" : "w-fit max-w-[108px]", className)}
      triggerClassName={
        iconOnly
          ? chatComposerIconButtonClassName()
          : chatComposerControlClassName("w-fit max-w-[108px]")
      }
      menuClassName="!min-w-0 w-max max-w-[160px]"
      menuAnimated={false}
      hideChevron
      iconOnly={iconOnly}
      tooltip="Select agent mode"
      aria-label="Select agent mode"
    />
  );
});
