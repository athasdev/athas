import { Plus } from "@phosphor-icons/react";
import { useCallback } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";

interface NewTabMenuProps {
  onClose?: () => void;
}

export function NewTabMenu({ onClose }: NewTabMenuProps) {
  const { showNewTabView } = useBufferStore.use.actions();

  const handleClick = useCallback(() => {
    showNewTabView();
    onClose?.();
  }, [showNewTabView, onClose]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={handleClick}
      className="text-text-lighter hover:border-border/70 hover:text-text"
      tooltip="New Tab"
      commandId="workbench.newTab"
      aria-label="New Tab"
    >
      <Plus />
    </Button>
  );
}
