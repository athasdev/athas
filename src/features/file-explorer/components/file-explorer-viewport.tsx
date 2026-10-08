import type React from "react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  FILE_TREE_MAX_STICKY_ROWS,
  FILE_TREE_VIEWPORT_OVERSCAN,
  FILE_TREE_VIEWPORT_PADDING,
  getFileTreeScrollTop,
  getFileTreeStickyLayout,
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

/** Where a row is drawn: in the scrolling list, or as a pinned copy in the sticky header stack. */
type FileTreeRowPlacement = "list" | "sticky";

interface FileExplorerViewportProps extends Omit<
  React.ComponentPropsWithoutRef<"div">,
  "children"
> {
  emptyState?: React.ReactNode;
  getRowKey: (index: number) => React.Key;
  /** Ancestor row indexes of a row, outermost first. Enables sticky folder headers. */
  getStickyAncestors?: (index: number) => readonly number[];
  /** The last row index inside a folder row's subtree. */
  getSubtreeEnd?: (index: number) => number;
  renderRow: (index: number, placement: FileTreeRowPlacement) => React.ReactNode;
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
    getStickyAncestors,
    getSubtreeEnd,
    renderRow,
    rowCount,
    rowHeight,
    style,
    ...props
  },
  forwardedRef,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
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

  // The virtual window has overscan rows on both sides, so it can follow a frame behind the
  // scroll position; only the sticky stack has to match the exact scroll offset.
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

  const getStickyRowCount = useCallback(
    (index: number, viewportHeight: number) => {
      if (!getStickyAncestors) return 0;
      const limit = Math.min(
        FILE_TREE_MAX_STICKY_ROWS,
        Math.max(1, Math.floor(viewportHeight / rowHeight / 2)),
      );
      return Math.min(limit, getStickyAncestors(index).length);
    },
    [getStickyAncestors, rowHeight],
  );

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
          viewportStartOffset: getStickyRowCount(index, element.clientHeight) * rowHeight,
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
    [getStickyRowCount, rowCount, rowHeight, updateLayout],
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
    <div className={cn("file-tree-container relative flex min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none scroll-auto scrollbar-gutter-both font-sans [overflow-anchor:none]"
        style={
          {
            "--file-tree-row-height": `${rowHeight}px`,
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        <div
          ref={contentRef}
          className="relative min-h-full w-full min-w-0 contain-layout contain-style [overflow-anchor:none]"
          style={{ height: getFileTreeTotalHeight(rowCount, rowHeight) }}
        >
          {virtualIndexes.map((index) => (
            <div
              key={getRowKey(index)}
              className="absolute inset-x-0 w-full min-w-0"
              style={{
                height: rowHeight,
                top: FILE_TREE_VIEWPORT_PADDING + index * rowHeight,
              }}
            >
              {renderRow(index, "list")}
            </div>
          ))}
        </div>
        {emptyState}
      </div>
      {getStickyAncestors && getSubtreeEnd ? (
        <FileTreeStickyHeaders
          scrollRef={scrollRef}
          contentRef={contentRef}
          getRowKey={getRowKey}
          getStickyAncestors={getStickyAncestors}
          getSubtreeEnd={getSubtreeEnd}
          renderRow={renderRow}
          rowCount={rowCount}
          rowHeight={rowHeight}
          viewportHeight={layout.viewportHeight}
        />
      ) : null}
    </div>
  );
});

interface FileTreeStickyHeadersProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  getRowKey: (index: number) => React.Key;
  getStickyAncestors: (index: number) => readonly number[];
  getSubtreeEnd: (index: number) => number;
  renderRow: (index: number, placement: FileTreeRowPlacement) => React.ReactNode;
  rowCount: number;
  rowHeight: number;
  viewportHeight: number;
}

interface StickyBounds {
  left: number;
  width: number;
}

/**
 * Pinned folder headers, drawn over the tree instead of inside it. Inside the scroller the layer
 * had to be moved back on every scroll event, which trailed the compositor's momentum scrolling
 * on macOS and made the headers shake; here it never moves, and only its rows change. The scroll
 * offset is read through an external store, so the rows update in the same frame as the scroll.
 */
function FileTreeStickyHeaders({
  scrollRef,
  contentRef,
  getRowKey,
  getStickyAncestors,
  getSubtreeEnd,
  renderRow,
  rowCount,
  rowHeight,
  viewportHeight,
}: FileTreeStickyHeadersProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<StickyBounds>({ left: 0, width: 0 });

  const subscribe = useCallback(
    (onChange: () => void) => {
      const element = scrollRef.current;
      if (!element) return () => {};
      element.addEventListener("scroll", onChange, { passive: true });
      return () => element.removeEventListener("scroll", onChange);
    },
    [scrollRef],
  );
  const scrollTop = useSyncExternalStore(
    subscribe,
    () => scrollRef.current?.scrollTop ?? 0,
    () => 0,
  );

  // Match the rows' horizontal box, which the scrollbar gutters inset on both sides.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    const layer = layerRef.current?.parentElement;
    if (!scroller || !content || !layer) return;

    const measure = () => {
      const contentRect = content.getBoundingClientRect();
      const layerRect = layer.getBoundingClientRect();
      const next = { left: contentRect.left - layerRect.left, width: contentRect.width };
      setBounds((current) =>
        current.left === next.left && current.width === next.width ? current : next,
      );
    };
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(scroller);
    resizeObserver.observe(content);
    measure();
    return () => resizeObserver.disconnect();
  }, [contentRef, scrollRef]);

  // The layer sits outside the scroller, so wheel input over it is handed to the tree.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    const handleWheel = (event: WheelEvent) => {
      const scroller = scrollRef.current;
      if (!scroller || event.ctrlKey) return;
      event.preventDefault();
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? rowHeight
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scroller.clientHeight
            : 1;
      scroller.scrollTop += event.deltaY * unit;
    };
    layer.addEventListener("wheel", handleWheel, { passive: false });
    return () => layer.removeEventListener("wheel", handleWheel);
  });

  const sticky = useMemo(
    () =>
      getFileTreeStickyLayout({
        scrollTop,
        rowCount,
        rowHeight,
        viewportHeight,
        getAncestors: getStickyAncestors,
        getSubtreeEnd,
      }),
    [getStickyAncestors, getSubtreeEnd, rowCount, rowHeight, scrollTop, viewportHeight],
  );

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      className={cn(
        "absolute top-0 z-20 overflow-hidden bg-background shadow-seam-top after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border",
        sticky.rows.length === 0 && "hidden",
      )}
      style={{ left: bounds.left, width: bounds.width, height: sticky.height }}
      data-file-tree-sticky-ancestors=""
    >
      {sticky.rows.map((row, level) => (
        <div
          key={`sticky-${String(getRowKey(row.index))}`}
          className="absolute inset-x-0 h-(--file-tree-row-height) w-full min-w-0 bg-background"
          style={
            {
              "--file-tree-row-height": `${rowHeight}px`,
              top: row.top,
              zIndex: sticky.rows.length - level,
            } as React.CSSProperties
          }
          data-file-tree-sticky-row=""
        >
          {renderRow(row.index, "sticky")}
        </div>
      ))}
    </div>
  );
}
