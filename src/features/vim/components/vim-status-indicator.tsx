import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useVimStore } from "@/features/vim/stores/vim.store";

const VimStatusIndicator = () => {
  const vimMode = useSettingsStore((state) => state.settings.vimMode);
  const mode = useVimStore.use.mode();

  if (!vimMode) {
    return null;
  }

  const modeDisplay = `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;

  return (
    <span
      className="font-sans inline-flex h-6 select-none items-center self-center px-1.5 ui-text-caption leading-none text-subtle-foreground/80"
      aria-label={`Vim mode: ${modeDisplay}`}
    >
      {modeDisplay}
    </span>
  );
};

export default VimStatusIndicator;
