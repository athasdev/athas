import { Database } from "@phosphor-icons/react";
import type { Action } from "../models/action.types";

interface DatabaseActionsParams {
  onClose: () => void;
  setIsDatabaseConnectionVisible: (v: boolean) => void;
}

export const createDatabaseActions = (params: DatabaseActionsParams): Action[] => {
  const { onClose, setIsDatabaseConnectionVisible } = params;

  return [
    {
      id: "database-connect",
      label: "Database: Connect to Database",
      description: "Open database connection dialog",
      icon: <Database />,
      category: "Database",
      commandId: "database.connect",
      action: () => {
        onClose();
        setIsDatabaseConnectionVisible(true);
      },
    },
  ];
};
