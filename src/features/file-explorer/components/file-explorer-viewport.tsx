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
  getFileTreeFirstVisibleIndex,
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
  getStickyIndexes?: (firstVisibleIndex: number) => readonly number[];
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
  {
    className,
    emptyState,
    getRowKey,
    getStickyIndexes,
    renderRow,
    rowCount,
    rowHeight,
    style,
    ...props
  },
  forwardedRef,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  // Sticky ancestors are pinned by hand rather than with `position: sticky`, which WKWebView
  // placed a few pixels below the top edge and let the row underneath show above them. Scroll
  // events run before paint, so moving the layer there keeps it fixed without a frame of lag.
  const syncStickyOffset = useCallback(() => {
    const element = scrollRef.current;
    const sticky = stickyRef.current;
    if (!element || !sticky) return;
    sticky.style.transform = `translateY(${element.scrollTop}px)`;
  }, []);
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

  const resolveStickyIndexes = useCallback(
    (firstVisibleIndex: number) => {
      if (!getStickyIndexes || firstVisibleIndex < 0) return [];

      const seen = new Set<number>();
      return getStickyIndexes(firstVisibleIndex).filter((index) => {
        if (index < 0 || index >= firstVisibleIndex || index >= rowCount || seen.has(index)) {
          return false;
        }
        seen.add(index);
        return true;
      });
    },
    [getStickyIndexes, rowCount],
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(updateLayout);
    resizeObserver.observe(element);
    element.addEventListener("scroll", syncStickyOffset, { passive: true });
    element.addEventListener("scroll", scheduleLayoutUpdate, { passive: true });
    updateLayout();

    return () => {
      resizeObserver.disconnect();
      element.removeEventListener("scroll", syncStickyOffset);
      element.removeEventListener("scroll", scheduleLayoutUpdate);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scheduleLayoutUpdate, syncStickyOffset, updateLayout]);

  // The sticky layer mounts and changes as rows scroll by; place it before each paint.
  useLayoutEffect(syncStickyOffset);

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
          viewportStartOffset: resolveStickyIndexes(index).length * rowHeight,
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
    [resolveStickyIndexes, rowCount, rowHeight, updateLayout],
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
  const firstVisibleIndex = useMemo(
    () =>
      getFileTreeFirstVisibleIndex({
        rowCount,
        rowHeight,
        scrollTop: layout.scrollTop,
      }),
    [layout.scrollTop, rowCount, rowHeight],
  );
  const stickyIndexes = useMemo(
    () => resolveStickyIndexes(firstVisibleIndex),
    [firstVisibleIndex, resolveStickyIndexes],
  );
  const stickyIndexSet = useMemo(() => new Set(stickyIndexes), [stickyIndexes]);

  return (
    <div
      ref={scrollRef}
      className={cn(
        "file-tree-container relative overflow-x-hidden overflow-y-auto overscroll-none scroll-auto scrollbar-gutter-both font-sans [overflow-anchor:none]",
        className,
      )}
      style={
        {
          "--file-tree-row-height": `${rowHeight}px`,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    >
      {stickyIndexes.length > 0 ? (
        <div
          ref={stickyRef}
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0 overflow-visible will-change-transform"
          data-file-tree-sticky-ancestors=""
        >
          <div
            className="pointer-events-auto relative w-full min-w-0 overflow-hidden bg-background shadow-seam-top after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border"
            style={{ height: stickyIndexes.length * rowHeight }}
          >
            {stickyIndexes.map((index) => (
              <div
                key={`sticky-${String(getRowKey(index))}`}
                className="h-(--file-tree-row-height) w-full min-w-0"
                data-file-tree-sticky-row=""
              >
                {renderRow(index)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div
        className="relative min-h-full w-full min-w-0 contain-layout contain-style [overflow-anchor:none]"
        style={{ height: getFileTreeTotalHeight(rowCount, rowHeight) }}
      >
        {virtualIndexes.map((index) =>
          stickyIndexSet.has(index) ? null : (
            <div
              key={getRowKey(index)}
              className="absolute inset-x-0 w-full min-w-0"
              style={{
                height: rowHeight,
                top: FILE_TREE_VIEWPORT_PADDING + index * rowHeight,
              }}
            >
              {renderRow(index)}
            </div>
          ),
        )}
      </div>
      {emptyState}
    </div>
  );
});
