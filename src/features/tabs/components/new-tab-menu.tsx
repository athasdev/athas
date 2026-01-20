import { Plus } from "lucide-react";
import { useCallback } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { cn } from "@/utils/cn";

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
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex size-5 items-center justify-center rounded transition-colors",
        "text-text-lighter hover:bg-hover hover:text-text",
      )}
      title="New Tab (Cmd+T)"
      aria-label="New Tab"
    >
      <Plus size={12} />
    </button>
  );
}
