import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";

export function GlobalNewTabMenu() {
  const { showNewTabView } = useBufferStore.use.actions();

  // Listen for global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "t") {
        e.preventDefault();
        showNewTabView();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showNewTabView]);

  // Listen for custom event from other components
  useEffect(() => {
    const handleOpenNewTabMenu = () => {
      showNewTabView();
    };

    window.addEventListener("open-new-tab-menu", handleOpenNewTabMenu);
    return () => window.removeEventListener("open-new-tab-menu", handleOpenNewTabMenu);
  }, [showNewTabView]);

  return null;
}
