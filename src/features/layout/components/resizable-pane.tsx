import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { cn } from "@/utils/cn";

type WidthSettingKey = "sidebarWidth" | "aiChatWidth";

const MIN_PANE_WIDTH = 50;
const MIN_SIDEBAR_WIDTH = 140;
const MIN_AI_CHAT_WIDTH = 300;
const MIN_AI_CHAT_COMPACT_WIDTH = 220;

interface ResizablePaneProps {
  children: React.ReactNode;
  position: "left" | "right";
  widthKey: WidthSettingKey;
  className?: string;
  edgePadding?: boolean;
  hidden?: boolean;
}

export function ResizablePane({
  children,
  position,
  widthKey,
  className,
  edgePadding = true,
  hidden = false,
}: ResizablePaneProps) {
  const storedWidth = useSettingsStore((state) => state.settings[widthKey]);
  const isAIChatVisible = useSettingsStore((state) => state.settings.isAIChatVisible);
  const sidebarWidth = useSettingsStore((state) => state.settings.sidebarWidth);
  const aiChatWidth = useSettingsStore((state) => state.settings.aiChatWidth);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const [width, setWidth] = useState(Math.max(storedWidth, MIN_PANE_WIDTH));
  const [isResizing, setIsResizing] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const getViewportWidth = () => (typeof window !== "undefined" ? window.innerWidth : 1280);

  const getMinWidth = useCallback(() => {
    if (widthKey === "aiChatWidth") {
      // Keep AI chat usable on normal widths, but relax for very small windows.
      return getViewportWidth() < 1100 ? MIN_AI_CHAT_COMPACT_WIDTH : MIN_AI_CHAT_WIDTH;
    }
    return MIN_SIDEBAR_WIDTH;
  }, [widthKey]);

  const getMaxWidth = useCallback(() => {
    const windowWidth = getViewportWidth();
    const MIN_MAIN_CONTENT_WIDTH = 360; // Keep editor area readable on smaller windows
    const shouldAccountForAiChat = isAIChatVisible;

    // Calculate available space accounting for both sidebars and minimum main content
    if (widthKey === "sidebarWidth" && shouldAccountForAiChat) {
      return Math.max(MIN_PANE_WIDTH, windowWidth - aiChatWidth - MIN_MAIN_CONTENT_WIDTH);
    }
    if (widthKey === "aiChatWidth" && isSidebarVisible) {
      return Math.max(MIN_PANE_WIDTH, windowWidth - sidebarWidth - MIN_MAIN_CONTENT_WIDTH);
    }

    // Single sidebar case - leave room for main content
    return Math.max(MIN_PANE_WIDTH, windowWidth - MIN_MAIN_CONTENT_WIDTH);
  }, [widthKey, isAIChatVisible, aiChatWidth, sidebarWidth, isSidebarVisible]);

  const clampWidth = useCallback(
    (value: number) => {
      const maxWidth = getMaxWidth();
      const minWidth = Math.min(getMinWidth(), maxWidth);
      return Math.max(minWidth, Math.min(value, maxWidth));
    },
    [getMaxWidth, getMinWidth],
  );

  useEffect(() => {
    const nextWidth = clampWidth(storedWidth);

    setWidth(nextWidth);
    if (nextWidth !== storedWidth) {
      updateSetting(widthKey, nextWidth);
    }
  }, [storedWidth, widthKey, updateSetting, clampWidth]);

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
      let rafId: number | null = null;

      const paneEl = paneRef.current;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = position === "right" ? startX - e.clientX : e.clientX - startX;
        const rawWidth = startWidth + deltaX;
        currentWidth = clampWidth(rawWidth);

        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          if (paneEl) {
            paneEl.style.width = `${currentWidth}px`;
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

  const handlePosition = position === "right" ? "left-[-8px]" : "right-[-8px]";
  return (
    <div
      ref={paneRef}
      style={{ width: hidden ? "0px" : `${width}px` }}
      className={cn(
        "athas-resizable-pane relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden bg-secondary-bg",
        hidden && "pointer-events-none",
        className,
      )}
      aria-hidden={hidden}
    >
      {!hidden && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            "absolute top-0 z-50 h-full w-4 cursor-col-resize transition-colors duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)]",
            handlePosition,
          )}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={Math.round(width)}
          aria-valuemin={Math.round(getMinWidth())}
          aria-valuemax={Math.round(getMaxWidth())}
          tabIndex={0}
        />
      )}
      {isResizing && <div className="pointer-events-none fixed inset-0 z-40 cursor-col-resize" />}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden py-0",
          edgePadding && !hidden && (position === "left" ? "pl-2" : "pr-2"),
        )}
      >
        <div
          className={cn(
            "athas-glass-island flex min-h-0 flex-1 flex-col overflow-hidden border border-border/70 bg-primary-bg",
            !hidden && "rounded-[var(--app-radius-card)]",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
