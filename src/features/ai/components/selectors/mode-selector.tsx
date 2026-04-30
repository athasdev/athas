import { memo, useMemo } from "react";
import { FadersHorizontal } from "@phosphor-icons/react";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode } from "@/features/ai/store/types";
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
}

const FALLBACK_MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "plan", label: "Plan" },
];

export const ModeSelector = memo(function ModeSelector({
  className,
  iconOnly = false,
  open,
  onOpenChange,
}: ModeSelectorProps) {
  const mode = useAIChatStore((state) => state.mode);
  const setMode = useAIChatStore((state) => state.setMode);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const chats = useAIChatStore((state) => state.chats);
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);
  const sessionModeState = useAIChatStore((state) => state.sessionModeState);
  const changeSessionMode = useAIChatStore((state) => state.changeSessionMode);

  const currentAgentId =
    chats.find((chat) => chat.id === currentChatId)?.agentId ?? selectedAgentId;
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
      size="xs"
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
      hideChevron
      iconOnly={iconOnly}
      tooltip="Select chat mode"
      aria-label="Select chat mode"
    />
  );
});
