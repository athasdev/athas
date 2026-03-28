import { ChevronsUpDown } from "lucide-react";
import { forwardRef, memo, useMemo } from "react";
import { useChatActions, useChatState } from "@/features/ai/hooks/use-chat-store";
import type { ChatScopeId } from "@/features/ai/types/ai-chat";
import Dropdown from "@/ui/dropdown";
import { cn } from "@/utils/cn";

interface SessionModeSelectorProps {
  className?: string;
  scopeId?: ChatScopeId;
  disabled?: boolean;
}

const ModeTrigger = forwardRef<
  HTMLButtonElement,
  {
    onClick?: () => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
    label: string;
    disabled?: boolean;
  }
>(({ onClick, onKeyDown, label, disabled }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    onKeyDown={onKeyDown}
    disabled={disabled}
    className="ui-font inline-flex h-8 min-w-[96px] items-center justify-between gap-1.5 rounded-xl border border-transparent px-2.5 text-xs transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
  >
    <span className="truncate">{label}</span>
    <ChevronsUpDown size={12} className="shrink-0 text-text-lighter" />
  </button>
));
ModeTrigger.displayName = "SessionModeTrigger";

export const SessionModeSelector = memo(function SessionModeSelector({
  className,
  scopeId,
  disabled = false,
}: SessionModeSelectorProps) {
  const chatState = useChatState(scopeId);
  const chatActions = useChatActions(scopeId);
  const sessionModeState = chatState.sessionModeState;

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
    chatActions.changeSessionMode(modeId);
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
        CustomTrigger={forwardRef<
          HTMLButtonElement,
          {
            onClick?: () => void;
            onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
          }
        >((props, ref) => (
          <ModeTrigger
            ref={ref}
            onClick={props.onClick}
            onKeyDown={props.onKeyDown}
            label={currentModeLabel || "Mode"}
            disabled={disabled}
          />
        ))}
      />
    </div>
  );
});
