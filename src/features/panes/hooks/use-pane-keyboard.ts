import { useEffect } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { usePaneStore } from "../stores/pane-store";

export function usePaneKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (!modKey) return;

      const paneStore = usePaneStore.getState();

      // Cmd+\ or Ctrl+\ - Split right
      if (e.key === "\\" && !e.shiftKey) {
        e.preventDefault();
        const activePane = paneStore.actions.getActivePane();
        if (activePane?.activeBufferId) {
          paneStore.actions.splitPane(activePane.id, "horizontal", activePane.activeBufferId);
        }
        return;
      }

      // Cmd+Shift+\ or Ctrl+Shift+\ - Split down
      if (e.key === "\\" && e.shiftKey) {
        e.preventDefault();
        const activePane = paneStore.actions.getActivePane();
        if (activePane?.activeBufferId) {
          paneStore.actions.splitPane(activePane.id, "vertical", activePane.activeBufferId);
        }
        return;
      }

      // Cmd+Option+Arrow or Ctrl+Alt+Arrow - Navigate between panes
      if (e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const directionMap: Record<string, "left" | "right" | "up" | "down"> = {
          ArrowLeft: "left",
          ArrowRight: "right",
          ArrowUp: "up",
          ArrowDown: "down",
        };
        paneStore.actions.navigateToPane(directionMap[e.key]);

        // Sync buffer store's activeBufferId with the newly active pane
        const newActivePane = paneStore.actions.getActivePane();
        if (newActivePane?.activeBufferId) {
          useBufferStore.getState().actions.setActiveBuffer(newActivePane.activeBufferId);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
