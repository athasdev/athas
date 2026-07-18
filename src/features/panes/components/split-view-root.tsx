import { useEffect } from "react";
import { WorkbenchFullscreenSurface } from "@/features/window/components/workbench-fullscreen-surface";
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

  return (
    <>
      <div className="size-full overflow-hidden">
        <PaneNodeRenderer node={root} hiddenPaneId={fullscreenPaneId} />
      </div>

      {fullscreenPane && (
        <WorkbenchFullscreenSurface>
          <PaneContainer pane={fullscreenPane} />
        </WorkbenchFullscreenSurface>
      )}
    </>
  );
}
