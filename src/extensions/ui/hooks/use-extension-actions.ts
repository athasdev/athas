import { useMemo } from "react";
import type { RegisteredToolbarAction } from "../types/ui-extension";
import { useUIExtensionStore } from "../stores/ui-extension-store";

export function useExtensionActions() {
  const toolbarActions = useUIExtensionStore.use.toolbarActions();

  return useMemo(() => {
    const left: RegisteredToolbarAction[] = [];
    const right: RegisteredToolbarAction[] = [];

    for (const action of toolbarActions.values()) {
      if (action.position === "left") {
        left.push(action);
      } else {
        right.push(action);
      }
    }

    return { left, right };
  }, [toolbarActions]);
}
