import type React from "react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FILE_TREE_VIEWPORT_OVERSCAN,
  FILE_TREE_VIEWPORT_PADDING,
  getFileTreeScrollTop,
  getFileTreeTotalHeight,
  getFileTreeVirtualRange,
  type FileTreeScrollAlignment,
} from "@/features/file-explorer/lib/file-tree-viewport";
import { cn } from "@/utils/cn";

export interface FileExplorerViewportHandle {
  focus: () => void;
  getScrollTop: () => number;
  scrollToIndex: (index: number, alignment?: FileTreeScrollAlignment) => boolean;
  setScrollTop: (scrollTop: number) => void;
}

interface FileExplorerViewportProps extends Omit<
  React.ComponentPropsWithoutRef<"div">,
  "children"
> {
  emptyState?: React.ReactNode;
  getRowKey: (index: number) => React.Key;
  renderRow: (index: number) => React.ReactNode;
  rowCount: number;
  rowHeight: number;
}

interface ViewportLayout {
  scrollTop: number;
  viewportHeight: number;
}

export const FileExplorerViewport = forwardRef<
  FileExplorerViewportHandle,
  FileExplorerViewportProps
>(function FileExplorerViewport(
  { className, emptyState, getRowKey, renderRow, rowCount, rowHeight, style, ...props },
  forwardedRef,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<ViewportLayout>({ scrollTop: 0, viewportHeight: 0 });

  const updateLayout = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const nextLayout = {
      scrollTop: element.scrollTop,
      viewportHeight: element.clientHeight,
    };
    setLayout((current) =>
      current.scrollTop === nextLayout.scrollTop &&
      current.viewportHeight === nextLayout.viewportHeight
        ? current
        : nextLayout,
    );
  }, []);

  const scheduleLayoutUpdate = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      updateLayout();
    });
  }, [updateLayout]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(updateLayout);
    resizeObserver.observe(element);
    element.addEventListener("scroll", scheduleLayoutUpdate, { passive: true });
    updateLayout();

    return () => {
      resizeObserver.disconnect();
      element.removeEventListener("scroll", scheduleLayoutUpdate);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scheduleLayoutUpdate, updateLayout]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const maxScrollTop = Math.max(
      0,
      getFileTreeTotalHeight(rowCount, rowHeight) - element.clientHeight,
    );
    if (element.scrollTop > maxScrollTop) {
      element.scrollTop = maxScrollTop;
    }
    updateLayout();
  }, [rowCount, rowHeight, updateLayout]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus: () => scrollRef.current?.focus(),
      getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
      scrollToIndex: (index, alignment = "nearest") => {
        const element = scrollRef.current;
        if (!element || index < 0 || index >= rowCount) return false;

        const nextScrollTop = getFileTreeScrollTop({
          alignment,
          currentScrollTop: element.scrollTop,
          index,
          rowCount,
          rowHeight,
          viewportHeight: element.clientHeight,
        });
        if (nextScrollTop === null) return false;

        if (nextScrollTop !== element.scrollTop) {
          element.scrollTop = nextScrollTop;
          updateLayout();
        }
        return true;
      },
      setScrollTop: (scrollTop) => {
        const element = scrollRef.current;
        if (!element) return;
        element.scrollTop = scrollTop;
        updateLayout();
      },
    }),
    [rowCount, rowHeight, updateLayout],
  );

  const range = useMemo(
    () =>
      getFileTreeVirtualRange({
        rowCount,
        rowHeight,
        scrollTop: layout.scrollTop,
        viewportHeight: layout.viewportHeight,
        overscan: FILE_TREE_VIEWPORT_OVERSCAN,
      }),
    [layout.scrollTop, layout.viewportHeight, rowCount, rowHeight],
  );
  const virtualIndexes = useMemo(() => {
    if (range.endIndex < range.startIndex) return [];
    return Array.from(
      { length: range.endIndex - range.startIndex + 1 },
      (_, offset) => range.startIndex + offset,
    );
  }, [range.endIndex, range.startIndex]);

  return (
    <div
      ref={scrollRef}
      className={cn("file-tree-container", className)}
      style={
        {
          "--file-tree-row-height": `${rowHeight}px`,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    >
      <div
        className="file-tree-virtual-canvas"
        style={{ height: getFileTreeTotalHeight(rowCount, rowHeight) }}
      >
        {virtualIndexes.map((index) => (
          <div
            key={getRowKey(index)}
            className="file-tree-virtual-row"
            style={{
              height: rowHeight,
              top: FILE_TREE_VIEWPORT_PADDING + index * rowHeight,
            }}
          >
            {renderRow(index)}
          </div>
        ))}
      </div>
      {emptyState}
    </div>
  );
});
