import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";

type WidthSettingKey = "sidebarWidth" | "aiChatWidth";

const MIN_PANE_WIDTH = 50;
const AI_CHAT_OVERLAY_BREAKPOINT = 1180;

interface ResizablePaneProps {
  children: React.ReactNode;
  position: "left" | "right";
  widthKey: WidthSettingKey;
  className?: string;
  collapsible?: boolean;
  // Pixels user must push past min width before auto-collapse.
  collapseThreshold?: number;
  onCollapse?: () => void;
}

export function ResizablePane({
  children,
  position,
  widthKey,
  className,
  collapsible = false,
  collapseThreshold = 0,
  onCollapse,
}: ResizablePaneProps) {
  const { settings, updateSetting } = useSettingsStore();
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const [width, setWidth] = useState(Math.max(settings[widthKey], MIN_PANE_WIDTH));
  const [isResizing, setIsResizing] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const getViewportWidth = () => (typeof window !== "undefined" ? window.innerWidth : 1280);

  const getMinWidth = useCallback(() => {
    if (widthKey === "aiChatWidth") {
      // Keep AI chat usable on normal widths, but relax for very small windows.
      return getViewportWidth() < 1100 ? 220 : 300;
    }
    // Sidebar can be narrower than AI chat.
    return 180;
  }, [widthKey]);

  const getMaxWidth = useCallback(() => {
    const windowWidth = getViewportWidth();
    const MIN_MAIN_CONTENT_WIDTH = 360; // Keep editor area readable on smaller windows
    const isCompactAiOverlay = windowWidth < AI_CHAT_OVERLAY_BREAKPOINT;
    const shouldAccountForAiChat = settings.isAIChatVisible && !isCompactAiOverlay;

    // Calculate available space accounting for both sidebars and minimum main content
    if (widthKey === "sidebarWidth" && shouldAccountForAiChat) {
      return Math.max(MIN_PANE_WIDTH, windowWidth - settings.aiChatWidth - MIN_MAIN_CONTENT_WIDTH);
    }
    if (widthKey === "aiChatWidth" && isSidebarVisible) {
      return Math.max(MIN_PANE_WIDTH, windowWidth - settings.sidebarWidth - MIN_MAIN_CONTENT_WIDTH);
    }

    // Single sidebar case - leave room for main content
    return Math.max(MIN_PANE_WIDTH, windowWidth - MIN_MAIN_CONTENT_WIDTH);
  }, [
    widthKey,
    settings.isAIChatVisible,
    settings.aiChatWidth,
    settings.sidebarWidth,
    isSidebarVisible,
  ]);

  const clampWidth = useCallback(
    (value: number) => {
      const maxWidth = getMaxWidth();
      const minWidth = Math.min(getMinWidth(), maxWidth);
      return Math.max(minWidth, Math.min(value, maxWidth));
    },
    [getMaxWidth, getMinWidth],
  );

  useEffect(() => {
    const storedWidth = settings[widthKey];
    const nextWidth = clampWidth(storedWidth);

    setWidth(nextWidth);
    if (nextWidth !== storedWidth) {
      updateSetting(widthKey, nextWidth);
    }
  }, [settings, widthKey, updateSetting, clampWidth]);

  useEffect(() => {
    const handleWindowResize = () => {
      const currentStored = useSettingsStore.getState().settings[widthKey];
      const nextWidth = clampWidth(currentStored);
      setWidth(nextWidth);
      if (nextWidth !== currentStored) {
        updateSetting(widthKey, nextWidth);
      }
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [widthKey, clampWidth, updateSetting]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = width;
      let currentWidth = startWidth;
      let collapseRequested = false;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = position === "right" ? startX - e.clientX : e.clientX - startX;
        const rawWidth = startWidth + deltaX;
        const minWidth = getMinWidth();
        const isClosingDrag = rawWidth < startWidth;
        const pushedPastMin = rawWidth <= minWidth - collapseThreshold;
        if (!collapseRequested && collapsible && isClosingDrag && pushedPastMin) {
          // Keep this sticky once user intentionally pushes past minimum.
          collapseRequested = true;
        }
        currentWidth = clampWidth(rawWidth);
        setWidth(currentWidth);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        if (collapseRequested) {
          onCollapse?.();
        } else {
          updateSetting(widthKey, currentWidth);
        }
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
    [
      width,
      position,
      widthKey,
      updateSetting,
      clampWidth,
      collapsible,
      collapseThreshold,
      onCollapse,
    ],
  );

  const handlePosition = position === "right" ? "left-0" : "right-0";
  return (
    <div
      ref={paneRef}
      style={{ width: `${width}px` }}
      className={cn(
        "relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden bg-secondary-bg",
        className,
      )}
    >
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "absolute top-0 z-50 h-full w-1.5 cursor-col-resize transition-colors duration-150",
          "hover:bg-accent/30 active:bg-accent/50",
          handlePosition,
          isResizing && "bg-accent/50",
        )}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={Math.round(getMinWidth())}
        aria-valuemax={Math.round(getMaxWidth())}
        tabIndex={0}
      />
      {isResizing && <div className="pointer-events-none fixed inset-0 z-40 cursor-col-resize" />}
      {children}
    </div>
  );
}
