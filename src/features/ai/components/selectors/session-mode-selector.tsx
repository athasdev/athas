import { memo, useMemo } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";

interface SessionModeSelectorProps {
  className?: string;
}

export const SessionModeSelector = memo(function SessionModeSelector({
  className,
}: SessionModeSelectorProps) {
  const sessionModeState = useAIChatStore((state) => state.sessionModeState);
  const changeSessionMode = useAIChatStore((state) => state.changeSessionMode);

  const modeOptions = useMemo(() => {
    return sessionModeState.availableModes.map((mode) => ({
      value: mode.id,
      label: mode.name,
    }));
  }, [sessionModeState.availableModes]);
  const handleModeChange = (modeId: string) => {
    changeSessionMode(modeId);
  };

  // Don't render if no modes available
  if (sessionModeState.availableModes.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center", className)}>
      <Select
        value={sessionModeState.currentModeId || ""}
        options={modeOptions}
        onChange={handleModeChange}
        size="xs"
        openDirection="up"
        placeholder="Mode"
        className="min-w-[96px]"
      />
    </div>
  );
});
