import { useEffect, useMemo } from "react";
import { IS_MAC } from "@/utils/platform";
import { usePaneStore } from "../stores/pane-store";
import { PaneContainer } from "./pane-container";
import { PaneNodeRenderer } from "./pane-node-renderer";

export function SplitViewRoot() {
  const root = usePaneStore.use.root();
  const bottomRoot = usePaneStore.use.bottomRoot();
  const fullscreenPaneId = usePaneStore.use.fullscreenPaneId();
  const { exitPaneFullscreen, getAllPaneGroups } = usePaneStore.use.actions();
  const fullscreenPane = useMemo(
    () =>
      fullscreenPaneId
        ? (getAllPaneGroups().find((pane) => pane.id === fullscreenPaneId) ?? null)
        : null,
    [fullscreenPaneId, getAllPaneGroups, root, bottomRoot],
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
      <div className="h-full w-full overflow-hidden">
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
          <div className="h-full overflow-hidden rounded-xl border border-border/80 bg-primary-bg shadow-2xl">
            <PaneContainer pane={fullscreenPane} />
          </div>
        </div>
      )}
    </>
  );
}
