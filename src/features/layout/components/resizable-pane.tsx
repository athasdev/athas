import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";

type WidthSettingKey = "sidebarWidth" | "aiChatWidth";

const MIN_PANE_WIDTH = 50;

interface ResizablePaneProps {
  children: React.ReactNode;
  position: "left" | "right";
  widthKey: WidthSettingKey;
  className?: string;
}

export function ResizablePane({ children, position, widthKey, className }: ResizablePaneProps) {
  const { settings, updateSetting } = useSettingsStore();
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const [width, setWidth] = useState(Math.max(settings[widthKey], MIN_PANE_WIDTH));
  const [isResizing, setIsResizing] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const storedWidth = settings[widthKey];
    if (storedWidth < MIN_PANE_WIDTH) {
      updateSetting(widthKey, MIN_PANE_WIDTH);
      setWidth(MIN_PANE_WIDTH);
    } else {
      setWidth(storedWidth);
    }
  }, [settings, widthKey, updateSetting]);

  const getMaxWidth = useCallback(() => {
    const windowWidth = window.innerWidth;

    // Only subtract the opposite pane's width - main view can shrink to 0
    if (widthKey === "sidebarWidth" && settings.isAIChatVisible) {
      return windowWidth - settings.aiChatWidth;
    }
    if (widthKey === "aiChatWidth" && isSidebarVisible) {
      return windowWidth - settings.sidebarWidth;
    }

    return windowWidth;
  }, [
    widthKey,
    settings.isAIChatVisible,
    settings.aiChatWidth,
    settings.sidebarWidth,
    isSidebarVisible,
  ]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = width;
      let currentWidth = startWidth;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = position === "right" ? startX - e.clientX : e.clientX - startX;
        const maxWidth = getMaxWidth();
        currentWidth = Math.max(MIN_PANE_WIDTH, Math.min(startWidth + deltaX, maxWidth));
        setWidth(currentWidth);
      };

      const handleMouseUp = () => {
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
    [width, position, widthKey, updateSetting, getMaxWidth],
  );

  const handlePosition = position === "right" ? "left-0" : "right-0";
  const borderSide = position === "right" ? "border-l" : "border-r";

  return (
    <div
      ref={paneRef}
      style={{ width: `${width}px` }}
      className={cn(
        "relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-border bg-secondary-bg",
        borderSide,
        className,
      )}
    >
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "absolute top-0 z-50 h-full w-1 cursor-col-resize transition-colors duration-150 hover:bg-accent/30",
          handlePosition,
          isResizing && "bg-accent/50",
        )}
      />
      {children}
    </div>
  );
}
