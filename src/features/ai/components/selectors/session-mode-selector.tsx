import { ChevronsUpDown } from "lucide-react";
import { memo, useMemo } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import Dropdown from "@/ui/dropdown";
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
  const currentModeLabel = useMemo(
    () => modeOptions.find((option) => option.value === sessionModeState.currentModeId)?.label,
    [modeOptions, sessionModeState.currentModeId],
  );

  const handleModeChange = (modeId: string) => {
    changeSessionMode(modeId);
  };

  // Don't render if no modes available
  if (sessionModeState.availableModes.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center", className)}>
      <Dropdown
        value={sessionModeState.currentModeId || ""}
        options={modeOptions}
        onChange={handleModeChange}
        size="xs"
        openDirection="up"
        className="min-w-[96px]"
        placeholder="Mode"
        CustomTrigger={({ ref, onClick }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            className="inline-flex h-8 min-w-[96px] items-center justify-between gap-1.5 rounded-full border border-border bg-secondary-bg/80 px-3 font-medium text-text text-xs transition-colors hover:bg-hover"
          >
            <span className="truncate">{currentModeLabel || "Mode"}</span>
            <ChevronsUpDown size={12} className="shrink-0 text-text-lighter" />
          </button>
        )}
      />
    </div>
  );
});
