import { memo, useMemo } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ChatMode } from "@/features/ai/store/types";
import Select from "@/ui/select";
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
      className={cn("max-w-[120px] px-1 py-0", className)}
      menuClassName="w-[248px]"
      aria-label="Select chat mode"
    />
  );
});
