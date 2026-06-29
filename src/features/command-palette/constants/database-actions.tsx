import { DatabaseIcon as Database } from "@phosphor-icons/react";
import type { Action } from "../types/action.types";

interface DatabaseActionsParams {
  openDatabaseCommand: () => void;
}

export const createDatabaseActions = (params: DatabaseActionsParams): Action[] => {
  const { openDatabaseCommand } = params;

  return [
    {
      id: "database-connect",
      label: "Database: Show Databases",
      description: "Open workspace database connections",
      icon: <Database />,
      category: "Database",
      commandId: "database.connect",
      action: () => {
        openDatabaseCommand();
      },
    },
  ];
};
