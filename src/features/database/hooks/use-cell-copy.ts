import { useCallback, useState } from "react";
import { formatDatabaseClipboardValue, writeDatabaseClipboardText } from "../utils/clipboard";

interface CellCopyState {
  position: { x: number; y: number } | null;
  value: unknown;
  columnName: string;
  copyText?: string;
  copyTextWithHeaders?: string;
}

export function useCellCopy() {
  const [cellMenu, setCellMenu] = useState<CellCopyState | null>(null);

  const handleCellContextMenu = useCallback(
    (
      e: React.MouseEvent,
      value: unknown,
      columnName: string,
      copyText?: string,
      copyTextWithHeaders?: string,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setCellMenu({
        position: { x: e.clientX, y: e.clientY },
        value,
        columnName,
        copyText,
        copyTextWithHeaders,
      });
    },
    [],
  );

  const copyValue = useCallback(async () => {
    if (!cellMenu) return;
    const text = cellMenu.copyText ?? formatCellValue(cellMenu.value);
    await writeDatabaseClipboardText(text);
    setCellMenu(null);
  }, [cellMenu]);

  const copyValueWithHeaders = useCallback(async () => {
    if (!cellMenu?.copyTextWithHeaders) return;
    await writeDatabaseClipboardText(cellMenu.copyTextWithHeaders);
    setCellMenu(null);
  }, [cellMenu]);

  const closeCellMenu = useCallback(() => {
    setCellMenu(null);
  }, []);

  return {
    cellMenu,
    handleCellContextMenu,
    copyValue,
    copyValueWithHeaders,
    closeCellMenu,
  };
}

export function formatCellValue(value: unknown): string {
  return formatDatabaseClipboardValue(value);
}
