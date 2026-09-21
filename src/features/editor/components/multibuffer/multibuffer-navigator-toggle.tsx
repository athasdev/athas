import { FilesIcon } from "@/ui/icons";
import { Button } from "@/ui/button";

interface MultibufferNavigatorToggleProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  count?: number;
}

/**
 * The one control that shows or hides a multibuffer's file navigator panel.
 * A chrome-sized labelled button so it is findable in a pane header, and every
 * multibuffer surface (diff reviews, search results, diagnostics) mounts this
 * same button so the affordance reads identically everywhere.
 */
export function MultibufferNavigatorToggle({
  open,
  onOpenChange,
  disabled = false,
  count,
}: MultibufferNavigatorToggleProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      active={open}
      disabled={disabled}
      aria-pressed={open}
      onClick={() => onOpenChange(!open)}
      tooltip={open ? "Hide the file list" : "Show the file list"}
      data-multibuffer-navigator-toggle=""
    >
      <FilesIcon />
      Files
      {typeof count === "number" ? <span className="font-mono">{count}</span> : null}
    </Button>
  );
}
