import { DatabaseIcon } from "@/ui/icons";
import type { Action } from "../types/action.types";

interface DatabaseActionsParams {
  openDatabaseSidebar: () => void;
}

export const createDatabaseActions = (params: DatabaseActionsParams): Action[] => {
  const { openDatabaseSidebar } = params;

  return [
    {
      id: "database-connect",
      label: "Database: Show Databases",
      description: "Show workspace database connections in the sidebar",
      icon: <DatabaseIcon />,
      category: "Database",
      commandId: "database.connect",
      action: () => {
        openDatabaseSidebar();
      },
    },
  ];
};
