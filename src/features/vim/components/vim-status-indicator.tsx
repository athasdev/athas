import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useVimStore } from "@/features/vim/stores/vim.store";
import { cn } from "@/utils/cn";

interface VimStatusIndicatorProps {
  compact?: boolean;
}

const VimStatusIndicator = ({ compact = false }: VimStatusIndicatorProps) => {
  const vimMode = useSettingsStore((state) => state.settings.vimMode);
  const mode = useVimStore.use.mode();

  // Don't show anything if vim mode is disabled
  if (!vimMode) {
    return null;
  }

  const modeDisplay = mode.toUpperCase();
  const statusChipClass = cn(
    "font-sans inline-flex h-5 items-center self-center rounded-full border border-transparent px-1.5 ui-text-sm leading-none text-text-lighter transition-colors hover:bg-hover hover:text-text",
    compact && "px-1.5",
  );

  return <span className={statusChipClass}>{modeDisplay}</span>;
};

export default VimStatusIndicator;
