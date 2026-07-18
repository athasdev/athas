import {
  ClockCounterClockwiseIcon as ClockCounterClockwise,
  FilePlusIcon as FilePlus,
} from "@/ui/icons";
import { openLocalHistoryForActiveFile } from "@/features/local-history/utils/open-local-history";
import { createTabActions } from "@/features/tabs/constants/tab-actions";
import type { Action } from "../types/action.types";

interface FileActionsParams {
  activeBufferId: string | null;
  closeBuffer: (bufferId: string) => void;
  switchToNextBuffer: () => void;
  switchToPreviousBuffer: () => void;
  reopenClosedTab: () => Promise<void>;
  onClose: () => void;
}

export const createFileActions = (params: FileActionsParams): Action[] => {
  const { onClose } = params;

  const baseActions: Action[] = [
    {
      id: "file-save-as",
      label: "File: Save As",
      description: "Save current file with a new name",
      icon: <FilePlus />,
      category: "File",
      commandId: "file.saveAs",
      action: () => {
        onClose();
        window.dispatchEvent(new CustomEvent("menu-save-as"));
      },
    },
    {
      id: "file-local-history",
      label: "File: Show Local History",
      description: "Open the selected file timeline",
      icon: <ClockCounterClockwise />,
      category: "File",
      commandId: "file.localHistory",
      action: () => {
        onClose();
        openLocalHistoryForActiveFile();
      },
    },
  ];

  // Include tab actions from the tabs feature
  const tabActions = createTabActions(params);

  return [...baseActions, ...tabActions];
};
