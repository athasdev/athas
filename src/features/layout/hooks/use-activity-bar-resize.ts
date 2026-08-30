import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

const DEFAULT_ACTIVITY_BAR_WIDTH = 160;
const MIN_ACTIVITY_BAR_WIDTH = 140;
const MAX_ACTIVITY_BAR_WIDTH = 320;

const clampActivityBarWidth = (width: number) =>
  Math.min(MAX_ACTIVITY_BAR_WIDTH, Math.max(MIN_ACTIVITY_BAR_WIDTH, Math.round(width)));

export function useActivityBarResize({ expanded }: { expanded: boolean }) {
  const configuredWidth = useSettingsStore((state) => state.settings.activityRailWidth);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [width, setWidth] = useState(() =>
    clampActivityBarWidth(configuredWidth || DEFAULT_ACTIVITY_BAR_WIDTH),
  );
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const isResizingRef = useRef(false);

  useEffect(() => {
    if (isResizingRef.current) return;
    setWidth(clampActivityBarWidth(configuredWidth || DEFAULT_ACTIVITY_BAR_WIDTH));
  }, [configuredWidth]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    };
  }, []);

  const previewWidth = useCallback((nextWidth: number) => {
    const clampedWidth = clampActivityBarWidth(nextWidth);

    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);

    resizeFrameRef.current = requestAnimationFrame(() => {
      setWidth(clampedWidth);
      resizeFrameRef.current = null;
    });
  }, []);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!expanded) return;

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = width;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      isResizingRef.current = true;
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const finishResize = (clientX: number) => {
        const nextWidth = clampActivityBarWidth(startWidth + clientX - startX);
        setWidth(nextWidth);
        void updateSetting("activityRailWidth", nextWidth);
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        previewWidth(startWidth + moveEvent.clientX - startX);
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;

        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }

        isResizingRef.current = false;
        setIsResizing(false);
        finishResize(upEvent.clientX);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [expanded, previewWidth, updateSetting, width],
  );

  return { width, isResizing, sidebarRef, handleResizeStart };
}
