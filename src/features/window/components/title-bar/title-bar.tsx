import { getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNativeWindowChrome } from "@/features/window/hooks/use-native-window-chrome";
import { ChromeBar, ChromeGroup, ChromeLabel } from "@/ui/chrome";
import { cn } from "@/utils/cn";
import { IS_MAC } from "@/utils/platform";
import { WindowControls } from "./window-controls";

interface TitleBarProps {
  showMinimal?: boolean;
  overlay?: boolean;
  title?: string;
  titleIcon?: ReactNode;
  titleActions?: ReactNode;
}

export default function TitleBar({
  overlay = false,
  title,
  titleIcon,
  titleActions,
}: TitleBarProps) {
  const usesNativeWindowChrome = useNativeWindowChrome();
  const showAppWindowControls = !IS_MAC && !usesNativeWindowChrome;
  const titleControlsRef = useRef<HTMLDivElement>(null);
  const [titleControlsWidth, setTitleControlsWidth] = useState(0);
  const [currentWindow, setCurrentWindow] = useState<TauriWindow | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!title && !titleIcon) return;
    const controls = titleControlsRef.current;
    if (!controls) return;
    const updateWidth = () => setTitleControlsWidth(controls.getBoundingClientRect().width);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [title, titleIcon]);

  useEffect(() => {
    const window = getCurrentWindow();
    setCurrentWindow(window);
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    const syncMaximized = () => {
      void window
        .isMaximized()
        .then((maximized) => {
          if (!disposed) setIsMaximized(maximized);
        })
        .catch(console.error);
    };
    syncMaximized();
    void window
      .onResized(syncMaximized)
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistenResize = unlisten;
      })
      .catch(console.error);
    return () => {
      disposed = true;
      unlistenResize?.();
    };
  }, []);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (
      (event.target as HTMLElement).closest(
        "button, a, input, textarea, select, [role='tab'], [contenteditable='true']",
      )
    )
      return;
    void currentWindow?.startDragging().catch(console.error);
  };

  return (
    <ChromeBar
      region="title"
      role="toolbar"
      aria-label="Window toolbar"
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      className={cn(
        "athas-title-bar z-50 justify-end select-none",
        overlay ? "pointer-events-none absolute top-0 right-0 w-auto" : "relative",
      )}
    >
      {(title || titleIcon) && (
        <ChromeGroup
          align="center"
          className="pointer-events-none absolute inset-y-0 overflow-hidden"
          style={{
            insetInline: `max(${IS_MAC ? "var(--athas-title-bar-leading-inset)" : "var(--athas-chrome-padding-inline)"}, calc(${titleControlsWidth}px + var(--athas-chrome-padding-inline)))`,
          }}
        >
          {titleIcon}
          {title ? <ChromeLabel tone="strong">{title}</ChromeLabel> : null}
        </ChromeGroup>
      )}
      <ChromeGroup ref={titleControlsRef}>
        {titleActions}
        {showAppWindowControls && (
          <WindowControls
            currentWindow={currentWindow}
            isMaximized={isMaximized}
            onMaximizedChange={setIsMaximized}
          />
        )}
      </ChromeGroup>
    </ChromeBar>
  );
}
