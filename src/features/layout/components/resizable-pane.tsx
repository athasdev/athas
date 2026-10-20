import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { cn } from "@/utils/cn";
import {
  clampResponsivePaneWidth,
  getResponsivePaneMaxWidth,
  MIN_RESPONSIVE_PANE_WIDTH,
} from "../utils/resizable-pane-layout";

const MIN_SIDEBAR_WIDTH = 140;

interface ResizablePaneProps {
  children: React.ReactNode;
  className?: string;
  hidden?: boolean;
  reservedWidth?: number;
}

/** The primary sidebar's resizable column, whose width is the `sidebarWidth` setting. */
export function ResizablePane({
  children,
  className,
  hidden = false,
  reservedWidth = 0,
}: ResizablePaneProps) {
  const storedWidth = useSettingsStore((state) => state.settings.sidebarWidth);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [width, setWidth] = useState(() =>
    Math.round(
      clampResponsivePaneWidth({
        value: Math.max(storedWidth, MIN_RESPONSIVE_PANE_WIDTH),
        minWidth: MIN_SIDEBAR_WIDTH,
        viewportWidth: typeof window !== "undefined" ? window.innerWidth : 1280,
        reservedWidth,
      }),
    ),
  );
  const [isResizing, setIsResizing] = useState(false);
  // Width only animates when the pane is shown or hidden. Settings loading, a project switch or a
  // window resize change it instantly, since an animated width re-lays out the editor every frame.
  const [previousHidden, setPreviousHidden] = useState(hidden);
  const [isTogglingVisibility, setIsTogglingVisibility] = useState(false);
  if (previousHidden !== hidden) {
    setPreviousHidden(hidden);
    setIsTogglingVisibility(true);
  }
  const paneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const getViewportWidth = () => (typeof window !== "undefined" ? window.innerWidth : 1280);

  const getMinWidth = useCallback(() => MIN_SIDEBAR_WIDTH, []);

  const getMaxWidth = useCallback(() => {
    return getResponsivePaneMaxWidth(getViewportWidth(), reservedWidth);
  }, [reservedWidth]);

  const clampWidth = useCallback(
    (value: number) => {
      // Whole pixels only: a fractional pane edge puts everything to its right on
      // a half pixel, and WebKit snaps that by 1px whenever a layer repaints.
      return Math.round(
        clampResponsivePaneWidth({
          value,
          minWidth: getMinWidth(),
          viewportWidth: getViewportWidth(),
          reservedWidth,
        }),
      );
    },
    [getMinWidth, reservedWidth],
  );

  useLayoutEffect(() => {
    setWidth(clampWidth(storedWidth));
  }, [storedWidth, clampWidth]);

  useEffect(() => {
    if (!isTogglingVisibility) return;
    const timeoutId = window.setTimeout(() => setIsTogglingVisibility(false), 250);
    return () => window.clearTimeout(timeoutId);
  }, [isTogglingVisibility]);

  useEffect(() => {
    const handleWindowResize = () => {
      const currentStored = useSettingsStore.getState().settings.sidebarWidth;
      const nextWidth = clampWidth(currentStored);
      setWidth(nextWidth);
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [clampWidth]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = width;
      let currentWidth = startWidth;
      let rafId: number | null = null;

      const paneEl = paneRef.current;
      const contentEl = contentRef.current;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - startX;
        const rawWidth = startWidth + deltaX;
        currentWidth = clampWidth(rawWidth);

        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (paneEl) {
            paneEl.style.width = `${currentWidth}px`;
          }
          if (contentEl) {
            contentEl.style.width = `${currentWidth}px`;
          }
        });
      };

      const handleMouseUp = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        setWidth(currentWidth);
        setIsResizing(false);
        updateSetting("sidebarWidth", currentWidth);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width, updateSetting, clampWidth],
  );

  const totalWidth = hidden ? "0px" : `${width}px`;
  const resizeHandle = !hidden ? (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        "group absolute top-0 right-0 z-30 flex h-full w-workbench cursor-col-resize items-center justify-center",
        "transition-colors duration-fast ease-smooth hover:bg-primary-soft",
      )}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(getMinWidth())}
      aria-valuemax={Math.round(getMaxWidth())}
      tabIndex={0}
    >
      <div
        className={cn(
          "h-full w-px bg-transparent transition-colors duration-fast ease-smooth group-hover:bg-primary",
          isResizing && "bg-primary",
        )}
      />
    </div>
  ) : null;

  return (
    <div
      ref={paneRef}
      style={{ width: totalWidth }}
      className={cn(
        "athas-resizable-pane relative flex h-full min-w-0 shrink-0 overflow-visible bg-transparent",
        isTogglingVisibility &&
          !isResizing &&
          "transition-[width] duration-fast ease-smooth motion-reduce:transition-none",
        hidden && "pointer-events-none",
        className,
      )}
      aria-hidden={hidden}
    >
      {isResizing && <div className="fixed inset-0 z-40 cursor-col-resize" />}
      <div
        ref={contentRef}
        style={{ width: hidden ? "0px" : `${width}px` }}
        className={cn(
          "flex min-h-0 shrink-0 flex-col overflow-hidden pr-workbench",
          isTogglingVisibility &&
            !isResizing &&
            "transition-[width] duration-fast ease-smooth motion-reduce:transition-none",
        )}
      >
        <div
          data-plane="page"
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
        >
          {children}
        </div>
      </div>
      {resizeHandle}
    </div>
  );
}
