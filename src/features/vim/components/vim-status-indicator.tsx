import { useSettingsStore } from "@/features/settings/store";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { cn } from "@/utils/cn";

const VimStatusIndicator = () => {
  const { settings } = useSettingsStore();
  const vimMode = settings.vimMode;
  const mode = useVimStore.use.mode();
  const isCommandMode = useVimStore.use.isCommandMode();
  const lastKey = useVimStore.use.lastKey();
  const keyBuffer = useVimStore.use.keyBuffer();
  const visualMode = useVimStore.use.visualMode();

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
        // Show visual mode type
        if (visualMode === "line") {
          return "VISUAL LINE";
        }
        if (visualMode === "block") {
          return "VISUAL BLOCK";
        }
        return "VISUAL";
      case "command":
        return "COMMAND";
      default:
        return "NORMAL";
    }
  };

  const modeDisplay = getModeDisplay();

  // Get color for each mode
  const getModeColor = () => {
    switch (modeDisplay) {
      case "NORMAL":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "INSERT":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "VISUAL":
      case "VISUAL LINE":
      case "VISUAL BLOCK":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "COMMAND":
        return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

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

  return (
    <div className="flex items-center gap-1">
      {/* Mode indicator */}
      <div
        className={cn(
          "ui-font rounded-sm border px-1 py-[1px] font-semibold text-xs tracking-wider",
          "transition-colors duration-200",
          getModeColor(),
        )}
      >
        {modeDisplay}
      </div>

      {/* Key buffer display */}
      {keyDisplay && (
        <div
          className={cn(
            "ui-font rounded-sm border px-1 py-[1px] text-xs",
            "border-gray-500/20 bg-gray-500/10 text-gray-300",
          )}
          title="Current keystroke sequence"
        >
          {keyDisplay}
        </div>
      )}
    </div>
  );
};

export default VimStatusIndicator;
