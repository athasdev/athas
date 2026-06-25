import { useEffect } from "react";
import { IS_MAC } from "@/utils/platform";
import { usePaneStore } from "../stores/pane.store";
import { findPaneGroup } from "../utils/pane-tree";
import { PaneContainer } from "./pane-container";
import { PaneNodeRenderer } from "./pane-node-renderer";

export function SplitViewRoot() {
  const root = usePaneStore.use.root();
  const fullscreenPaneId = usePaneStore.use.fullscreenPaneId();
  const exitPaneFullscreen = usePaneStore((state) => state.actions.exitPaneFullscreen);
  const fullscreenPane = usePaneStore((state) =>
    state.fullscreenPaneId
      ? (findPaneGroup(state.root, state.fullscreenPaneId) ??
        findPaneGroup(state.bottomRoot, state.fullscreenPaneId))
      : null,
  );

  useEffect(() => {
    if (fullscreenPaneId && !fullscreenPane) {
      exitPaneFullscreen();
    }
  }, [exitPaneFullscreen, fullscreenPane, fullscreenPaneId]);

  const titleBarHeight = IS_MAC ? 44 : 28;
  const footerHeight = 32;

  return (
    <>
      <div className="size-full overflow-hidden">
        <PaneNodeRenderer node={root} hiddenPaneId={fullscreenPaneId} />
      </div>

      {fullscreenPane && (
        <div
          className="fixed inset-x-2 z-[10040]"
          style={{
            top: `${titleBarHeight + 8}px`,
            bottom: `${footerHeight + 8}px`,
          }}
        >
          <div className="h-full overflow-hidden rounded-xl border border-border/80 bg-primary-bg shadow-[var(--shadow-dialog)]">
            <PaneContainer pane={fullscreenPane} />
          </div>
        </div>
      )}
    </>
  );
}
