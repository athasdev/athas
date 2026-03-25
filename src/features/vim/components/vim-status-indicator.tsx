import { useSettingsStore } from "@/features/settings/store";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { cn } from "@/utils/cn";

interface VimStatusIndicatorProps {
  compact?: boolean;
}

const VimStatusIndicator = ({ compact = false }: VimStatusIndicatorProps) => {
  const { settings } = useSettingsStore();
  const vimMode = settings.vimMode;
  const mode = useVimStore.use.mode();
  const isCommandMode = useVimStore.use.isCommandMode();
  const lastKey = useVimStore.use.lastKey();
  const keyBuffer = useVimStore.use.keyBuffer();

  // Don't show anything if vim mode is disabled
  if (!vimMode) {
    return null;
  }

  // Get mode display directly instead of calling function
  const getModeDisplay = () => {
    if (isCommandMode) return "COMMAND";

    switch (mode) {
      case "normal":
        return "NORMAL";
      case "insert":
        return "INSERT";
      case "visual":
        return "VISUAL";
      case "command":
        return "COMMAND";
      default:
        return "NORMAL";
    }
  };

  const modeDisplay = getModeDisplay();

  // Get current keystrokes being typed
  const getKeyDisplay = () => {
    // Show last key if waiting for next key (like after pressing 'r' or 'g')
    if (lastKey && !keyBuffer.length) {
      return lastKey;
    }
    // Show key buffer if typing a command sequence
    if (keyBuffer.length > 0) {
      return keyBuffer.join("");
    }
    return null;
  };

  const keyDisplay = getKeyDisplay();
  const statusChipClass = cn(
    "ui-font inline-flex h-5 items-center rounded-md border border-transparent px-1.5 text-[10px] text-text-lighter transition-colors hover:bg-hover hover:text-text",
    compact && "px-1.5",
  );

  return (
    <div className="flex items-center gap-1">
      <span className={statusChipClass}>
        {modeDisplay}
      </span>

      {keyDisplay && (
        <span className={statusChipClass} title="Current keystroke sequence">
          {keyDisplay}
        </span>
      )}
    </div>
  );
};

export default VimStatusIndicator;
