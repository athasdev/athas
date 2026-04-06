import { EditIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";

export const SqliteTableMenu = ({
  onCreateRow,
  onDeleteTable,
}: {
  onCreateRow: (tableName: string) => void;
  onDeleteTable: (tableName: string) => void;
}) => {
  const { databaseTableMenu, setDatabaseTableMenu } = useUIState();

  const onCloseMenu = () => setDatabaseTableMenu(null);
  const items: ContextMenuItem[] = databaseTableMenu
    ? [
        {
          id: "create-row",
          label: "Add New Row",
          icon: <PlusIcon />,
          onClick: () => onCreateRow(databaseTableMenu.tableName),
        },
        { id: "separator", label: "", separator: true, onClick: () => {} },
        {
          id: "delete-table",
          label: "Delete Table",
          icon: <TrashIcon />,
          onClick: () => onDeleteTable(databaseTableMenu.tableName),
        },
      ]
    : [];

  return (
    <ContextMenu
      isOpen={!!databaseTableMenu}
      position={
        databaseTableMenu ? { x: databaseTableMenu.x, y: databaseTableMenu.y } : { x: 0, y: 0 }
      }
      items={items}
      onClose={onCloseMenu}
    />
  );
};

export const SqliteRowMenu = ({
  onEditRow,
  onDeleteRow,
}: {
  onEditRow: (tableName: string, rowData: Record<string, any>) => void;
  onDeleteRow: (tableName: string, rowData: Record<string, any>) => void;
}) => {
  const { databaseRowMenu, setDatabaseRowMenu } = useUIState();

  const onCloseMenu = () => setDatabaseRowMenu(null);
  const items: ContextMenuItem[] = databaseRowMenu
    ? [
        {
          id: "edit-row",
          label: "Edit Row",
          icon: <EditIcon />,
          onClick: () => onEditRow(databaseRowMenu.tableName, databaseRowMenu.rowData),
        },
        {
          id: "delete-row",
          label: "Delete Row",
          icon: <TrashIcon />,
          onClick: () => onDeleteRow(databaseRowMenu.tableName, databaseRowMenu.rowData),
        },
      ]
    : [];

  return (
    <ContextMenu
      isOpen={!!databaseRowMenu}
      position={databaseRowMenu ? { x: databaseRowMenu.x, y: databaseRowMenu.y } : { x: 0, y: 0 }}
      items={items}
      onClose={onCloseMenu}
    />
  );
};
