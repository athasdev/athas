import { useContext, useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import TabBar from "@/features/tabs/components/tab-bar";
import { usePaneStore } from "../stores/pane.store";
import { MainTabBarHostContext } from "../contexts/main-tab-bar-host";

interface MainPaneTabBarProps {
  paneId: string;
  onTabClick: (bufferId: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  disablePaneActions: boolean;
}

interface HeaderPosition {
  left: number;
  width: number;
}

export function MainPaneTabBar({
  paneId,
  onTabClick,
  containerRef,
  active,
  disablePaneActions,
}: MainPaneTabBarProps) {
  const host = useContext(MainTabBarHostContext);
  const [headerPosition, setHeaderPosition] = useState<HeaderPosition | null>(null);
  const fullscreenPaneId = usePaneStore.use.fullscreenPaneId();

  useLayoutEffect(() => {
    const pane = containerRef.current;
    // While a pane is fullscreen it owns the title bar; the panes behind it keep their tabs inline.
    const isFullscreen = fullscreenPaneId === paneId;
    if (!host || !pane || !active || disablePaneActions || (fullscreenPaneId && !isFullscreen)) {
      setHeaderPosition(null);
      return;
    }

    const updatePosition = () => {
      const paneRect = pane.getBoundingClientRect();
      const contentRect = host.content.getBoundingClientRect();
      const headerRect = host.header.getBoundingClientRect();
      const top = paneRect.top - contentRect.top;
      const isFirstPane = Math.abs(paneRect.left - contentRect.left) <= 2;
      const nextPosition = isFullscreen
        ? { left: 0, width: headerRect.width }
        : top >= 0 && top <= 2
          ? {
              left: isFirstPane ? 0 : paneRect.left - headerRect.left,
              width: isFirstPane ? paneRect.right - headerRect.left : paneRect.width,
            }
          : null;
      setHeaderPosition((current) =>
        current?.left === nextPosition?.left && current?.width === nextPosition?.width
          ? current
          : nextPosition,
      );
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(pane);
    observer.observe(host.header);
    observer.observe(host.content);
    window.addEventListener("resize", updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, [active, containerRef, disablePaneActions, fullscreenPaneId, host, paneId]);

  const inTitleBar = Boolean(host && headerPosition);
  const tabBar = (
    <TabBar
      paneId={paneId}
      onTabClick={onTabClick}
      disablePaneActions={disablePaneActions}
      inTitleBar={inTitleBar}
    />
  );

  return host && headerPosition
    ? createPortal(
        <div
          data-slot="title-pane-tabs"
          className="absolute inset-y-0 min-w-0"
          style={headerPosition}
        >
          {tabBar}
        </div>,
        host.header,
      )
    : tabBar;
}
