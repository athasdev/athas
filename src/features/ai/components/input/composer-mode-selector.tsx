import { getCurrentModeOption } from "@/features/ai/lib/composer-modes";
import { applyChatMode } from "@/features/ai/services/chat-mode-service";
import type { ChatModeSource } from "@/features/ai/types/composer-mode.types";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";

/** The chat's mode as a composer chip: Agent, Ask and Plan, or whatever modes the agent offers. */
export function ComposerModeSelector({
  source,
  onBeforeOpen,
}: {
  source: ChatModeSource;
  onBeforeOpen?: () => void;
}) {
  const current = getCurrentModeOption(source);
  if (!current || source.options.length < 2) return null;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onBeforeOpen?.();
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            truncate
            aria-label={`Mode: ${current.label}`}
            tooltip="Change mode"
            shortcut="shift+tab"
          />
        }
      >
        <span className="min-w-0 truncate">{current.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" size="compact">
        <DropdownMenuRadioGroup
          value={current.id}
          onValueChange={(modeId) => applyChatMode(source, modeId)}
        >
          {source.options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} closeOnClick>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
