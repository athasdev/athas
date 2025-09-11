import { useSettingsStore } from "@/settings/store";
import { useVimStore } from "@/stores/vim-store";
import { cn } from "@/utils/cn";

const VimStatusIndicator = () => {
  const { settings } = useSettingsStore();
  const vimMode = settings.vimMode;
  const mode = useVimStore.use.mode();
  const isCommandMode = useVimStore.use.isCommandMode();

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

  // Get color for each mode
  const getModeColor = () => {
    switch (modeDisplay) {
      case "NORMAL":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "INSERT":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "VISUAL":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "COMMAND":
        return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      default:
        return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  return (
    <div
      className={cn(
        "rounded-sm border px-1 py-[1px] font-mono font-semibold text-xs tracking-wider",
        "transition-colors duration-200",
        getModeColor(),
      )}
    >
      {modeDisplay}
    </div>
  );
};

export default VimStatusIndicator;
