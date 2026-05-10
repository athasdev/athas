import { useEffect } from "react";
import { IS_MAC } from "@/utils/platform";
import { usePaneStore } from "../stores/pane-store";
import { activatePaneAndSyncBuffer } from "../utils/pane-activation";
import { splitActiveEditorGroup } from "../utils/pane-command-actions";

export function usePaneKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modKey = IS_MAC ? e.metaKey : e.ctrlKey;

      if (!modKey) return;

      const paneStore = usePaneStore.getState();

      // Cmd+\ or Ctrl+\ - Split right
      if (e.key === "\\" && !e.shiftKey) {
        e.preventDefault();
        splitActiveEditorGroup("horizontal");
        return;
      }

      // Cmd+Shift+\ or Ctrl+Shift+\ - Split down
      if (e.key === "\\" && e.shiftKey) {
        e.preventDefault();
        splitActiveEditorGroup("vertical");
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

        const newActivePane = paneStore.actions.getActivePane();
        if (newActivePane) {
          activatePaneAndSyncBuffer(newActivePane.id);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
