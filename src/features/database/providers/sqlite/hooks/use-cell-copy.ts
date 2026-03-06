import { useCallback, useState } from "react";

interface CellCopyState {
  position: { x: number; y: number } | null;
  value: unknown;
  columnName: string;
}

export function useCellCopy() {
  const [cellMenu, setCellMenu] = useState<CellCopyState | null>(null);

  const handleCellContextMenu = useCallback(
    (e: React.MouseEvent, value: unknown, columnName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setCellMenu({ position: { x: e.clientX, y: e.clientY }, value, columnName });
    },
    [],
  );

  const copyValue = useCallback(async () => {
    if (!cellMenu) return;
    const text = formatCellValue(cellMenu.value);
    await navigator.clipboard.writeText(text);
    setCellMenu(null);
  }, [cellMenu]);

  const closeCellMenu = useCallback(() => {
    setCellMenu(null);
  }, []);

  return {
    cellMenu,
    handleCellContextMenu,
    copyValue,
    closeCellMenu,
  };
}

export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
