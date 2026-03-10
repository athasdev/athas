import { Database } from "lucide-react";
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
      icon: <Database size={14} />,
      category: "Database",
      keybinding: ["\u2318", "\u21e7", "D"],
      action: () => {
        onClose();
        setIsDatabaseConnectionVisible(true);
      },
    },
  ];
};
