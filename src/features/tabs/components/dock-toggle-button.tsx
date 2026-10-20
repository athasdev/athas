import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { useDockHasContent, useDockShown } from "@/features/layout/hooks/use-dock-shown";
import { toggleDock } from "@/features/layout/services/dock-visibility";
import { Button } from "@/ui/button";
import { SidebarRightIcon } from "@/ui/icons";

/** The switch at the end of the top-right tab bar that shows or puts away the dock. */
export function DockToggleButton() {
  const shown = useDockShown();
  const hasContent = useDockHasContent();
  const shortcut = useCommandShortcut("workbench.toggleDock");
  if (shown === null || !hasContent) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      iconOnly
      size="sm"
      active={shown}
      aria-pressed={shown}
      aria-label={shown ? "Hide dock" : "Show dock"}
      tooltip={shown ? "Hide Dock" : "Show Dock"}
      shortcut={shortcut}
      onClick={toggleDock}
    >
      <SidebarRightIcon />
    </Button>
  );
}
