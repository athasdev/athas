import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { cn } from "@/utils/cn";
import {
  clampResponsivePaneWidth,
  getResponsivePaneMaxWidth,
  MIN_RESPONSIVE_PANE_WIDTH,
} from "../utils/resizable-pane-layout";

type WidthSettingKey = "sidebarWidth" | "aiChatWidth";

const MIN_SIDEBAR_WIDTH = 140;
const MIN_AI_CHAT_WIDTH = 300;
const MIN_AI_CHAT_COMPACT_WIDTH = 220;

interface ResizablePaneProps {
  children: React.ReactNode;
  position: "left" | "right";
  widthKey: WidthSettingKey;
  className?: string;
  hidden?: boolean;
  outerEdge?: boolean;
  reservedWidth?: number;
}

export function ResizablePane({
  children,
  position,
  widthKey,
  className,
  hidden = false,
  outerEdge = true,
  reservedWidth = 0,
}: ResizablePaneProps) {
  const storedWidth = useSettingsStore((state) => state.settings[widthKey]);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [width, setWidth] = useState(Math.max(storedWidth, MIN_RESPONSIVE_PANE_WIDTH));
  const [isResizing, setIsResizing] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const getViewportWidth = () => (typeof window !== "undefined" ? window.innerWidth : 1280);

  const getMinWidth = useCallback(() => {
    if (widthKey === "aiChatWidth") {
      // Keep AI chat usable on normal widths, but relax for very small windows.
      return getViewportWidth() < 1100 ? MIN_AI_CHAT_COMPACT_WIDTH : MIN_AI_CHAT_WIDTH;
    }
    return MIN_SIDEBAR_WIDTH;
  }, [widthKey]);

  const getMaxWidth = useCallback(() => {
    return getResponsivePaneMaxWidth(getViewportWidth(), reservedWidth);
  }, [reservedWidth]);

  const clampWidth = useCallback(
    (value: number) => {
      return clampResponsivePaneWidth({
        value,
        minWidth: getMinWidth(),
        viewportWidth: getViewportWidth(),
        reservedWidth,
      });
    },
    [getMinWidth, reservedWidth],
  );

  useEffect(() => {
    const nextWidth = clampWidth(storedWidth);

    setWidth(nextWidth);
  }, [storedWidth, clampWidth]);

  useEffect(() => {
    const handleWindowResize = () => {
      const currentStored = useSettingsStore.getState().settings[widthKey];
      const nextWidth = clampWidth(currentStored);
      setWidth(nextWidth);
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [widthKey, clampWidth]);

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
        const deltaX = position === "right" ? startX - e.clientX : e.clientX - startX;
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
        updateSetting(widthKey, currentWidth);
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
    [width, position, widthKey, updateSetting, clampWidth],
  );

  const totalWidth = hidden ? "0px" : `${width}px`;
  const resizeHandle = !hidden ? (
    <div
      onMouseDown={handleMouseDown}
      style={
        position === "left"
          ? { right: "calc(var(--athas-workbench-gap) / -2)" }
          : { left: "calc(var(--athas-workbench-gap) / -2)" }
      }
      className={cn(
        "group absolute top-0 z-30 flex h-full w-[var(--athas-workbench-gap)] cursor-col-resize items-center justify-center",
        "transition-colors duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:bg-accent/8",
      )}
      role="separator"
      aria-orientation="vertical"
      aria-label={widthKey === "aiChatWidth" ? "Resize AI chat" : "Resize sidebar"}
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(getMinWidth())}
      aria-valuemax={Math.round(getMaxWidth())}
      tabIndex={0}
    >
      <div
        className={cn(
          "h-full w-px bg-transparent transition-colors duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] group-hover:bg-accent",
          isResizing && "bg-accent",
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
        hidden && "pointer-events-none",
        className,
      )}
      aria-hidden={hidden}
    >
      {position === "right" ? resizeHandle : null}
      {isResizing && <div className="fixed inset-0 z-40 cursor-col-resize" />}
      <div
        ref={contentRef}
        style={{ width: hidden ? "0px" : `${width}px` }}
        className="flex min-h-0 shrink-0 flex-col overflow-hidden py-0"
      >
        <div
          className={cn(
            "athas-glass-island flex min-h-0 flex-1 flex-col overflow-hidden border-border/70 border-y bg-primary-bg",
            position === "left" && "border-l border-r",
            position === "right" && "border-r",
            !hidden && position === "left" && "rounded-l-xl",
            !hidden && position === "right" && outerEdge && "rounded-r-xl",
          )}
        >
          {children}
        </div>
      </div>
      {position === "left" ? resizeHandle : null}
    </div>
  );
}
