import { DatabaseIcon as Database } from "@phosphor-icons/react";
import type { Action } from "../models/action.types";

interface DatabaseActionsParams {
  onClose: () => void;
  openDatabaseSidebar: () => void;
}

export const createDatabaseActions = (params: DatabaseActionsParams): Action[] => {
  const { onClose, openDatabaseSidebar } = params;

  return [
    {
      id: "database-connect",
      label: "Database: Show Databases",
      description: "Open workspace database connections",
      icon: <Database />,
      category: "Database",
      commandId: "database.connect",
      action: () => {
        onClose();
        openDatabaseSidebar();
      },
    },
  ];
};
