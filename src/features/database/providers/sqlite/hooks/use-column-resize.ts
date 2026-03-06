import { useCallback, useRef } from "react";
import { useSqliteStore } from "../stores/sqlite-store";

const MIN_COLUMN_WIDTH = 60;
const DEFAULT_COLUMN_WIDTH = 150;

export function useColumnResize(tableName: string | null) {
  const actions = useSqliteStore.use.actions();
  const columnWidths = useSqliteStore.use.columnWidths();
  const resizeRef = useRef<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const getColumnWidth = useCallback(
    (column: string): number => {
      if (!tableName) return DEFAULT_COLUMN_WIDTH;
      return columnWidths[tableName]?.[column] ?? DEFAULT_COLUMN_WIDTH;
    },
    [tableName, columnWidths],
  );

  const handleResizeStart = useCallback(
    (e: React.PointerEvent, column: string) => {
      e.preventDefault();
      e.stopPropagation();

      const startWidth = getColumnWidth(column);
      resizeRef.current = { column, startX: e.clientX, startWidth };

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
    },
    [getColumnWidth],
  );

  const handleResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeRef.current || !tableName) return;

      const { column, startX, startWidth } = resizeRef.current;
      const delta = e.clientX - startX;
      const newWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + delta);
      actions.setColumnWidth(tableName, column, newWidth);
    },
    [tableName, actions],
  );

  const handleResizeEnd = useCallback(() => {
    resizeRef.current = null;
  }, []);

  return {
    getColumnWidth,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    isResizing: resizeRef.current !== null,
  };
}

export { MIN_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH };
