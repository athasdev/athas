import { Plus } from "lucide-react";
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
      title="New Tab (Cmd+T)"
      aria-label="New Tab"
    >
      <Plus />
    </Button>
  );
}
