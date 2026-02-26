import { EditIcon, PlusIcon, TrashIcon } from "lucide-react";
import { type RefObject, useRef } from "react";
import { useOnClickOutside } from "usehooks-ts";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";

export const SqliteTableMenu = ({
  onCreateRow,
  onDeleteTable,
}: {
  onCreateRow: (tableName: string) => void;
  onDeleteTable: (tableName: string) => void;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { sqliteTableMenu, setSqliteTableMenu } = useUIState();

  const onCloseMenu = () => setSqliteTableMenu(null);

  useOnClickOutside(menuRef as RefObject<HTMLElement>, () => {
    setSqliteTableMenu(null);
  });

  if (!sqliteTableMenu) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[10040] min-w-[200px] rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      style={{
        left: sqliteTableMenu.x,
        top: sqliteTableMenu.y,
      }}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCreateRow(sqliteTableMenu.tableName);
          onCloseMenu();
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5",
          "ui-font text-left text-text text-xs transition-colors hover:bg-hover",
        )}
      >
        <PlusIcon size="12" />
        Add New Row
      </button>

      <div className="my-1 border-border/70 border-t"></div>

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDeleteTable(sqliteTableMenu.tableName);
          onCloseMenu();
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5",
          "ui-font text-left text-red-400 text-xs transition-colors hover:bg-hover",
        )}
      >
        <TrashIcon size="12" />
        Delete Table
      </button>
    </div>
  );
};

export const SqliteRowMenu = ({
  onEditRow,
  onDeleteRow,
}: {
  onEditRow: (tableName: string, rowData: Record<string, any>) => void;
  onDeleteRow: (tableName: string, rowData: Record<string, any>) => void;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { sqliteRowMenu, setSqliteRowMenu } = useUIState();

  const onCloseMenu = () => setSqliteRowMenu(null);

  useOnClickOutside(menuRef as RefObject<HTMLElement>, () => {
    setSqliteRowMenu(null);
  });

  if (!sqliteRowMenu) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[10040] min-w-[180px] rounded-xl border border-border bg-secondary-bg/95 p-1 shadow-[0_14px_30px_-24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      style={{
        left: sqliteRowMenu.x,
        top: sqliteRowMenu.y,
      }}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onEditRow(sqliteRowMenu.tableName, sqliteRowMenu.rowData);
          onCloseMenu();
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5",
          "ui-font text-left text-text text-xs transition-colors hover:bg-hover",
        )}
      >
        <EditIcon size="12" />
        Edit Row
      </button>

      <button
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDeleteRow(sqliteRowMenu.tableName, sqliteRowMenu.rowData);
          onCloseMenu();
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5",
          "ui-font text-left text-red-400 text-xs transition-colors hover:bg-hover",
        )}
      >
        <TrashIcon size="12" />
        Delete Row
      </button>
    </div>
  );
};
