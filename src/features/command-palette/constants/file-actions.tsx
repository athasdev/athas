import {
  ClockCounterClockwiseIcon as ClockCounterClockwise,
  FilePlusIcon as FilePlus,
  FloppyDiskIcon as Save,
  FolderOpenIcon as FolderOpen,
} from "@/ui/icons";
import { openLocalHistoryForActiveFile } from "@/features/local-history/utils/open-local-history";
import { createTabActions } from "@/features/tabs/constants/tab-actions";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import type { Action } from "../types/action.types";

interface FileActionsParams {
  activeBufferId: string | null;
  closeBuffer: (bufferId: string) => void;
  switchToNextBuffer: () => void;
  switchToPreviousBuffer: () => void;
  reopenClosedTab: () => Promise<void>;
  openMarkdownDocument: () => void;
  onClose: () => void;
}

export const createFileActions = (params: FileActionsParams): Action[] => {
  const { onClose } = params;

  const baseActions: Action[] = [
    {
      id: "file-new",
      label: "File: New File",
      description: "Create a file in the current workspace",
      icon: <FilePlus />,
      category: "File",
      commandId: "file.new",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("file.new");
      },
    },
    {
      id: "file-new-document",
      label: "File: New Document",
      description: "Open an untitled document in the rich Markdown editor",
      icon: <FilePlus />,
      category: "File",
      action: () => {
        onClose();
        params.openMarkdownDocument();
      },
    },
    {
      id: "file-open-project",
      label: "File: Open Project",
      description: "Open a folder or project",
      icon: <FolderOpen />,
      category: "File",
      commandId: "file.open",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("file.open");
      },
    },
    {
      id: "file-save",
      label: "File: Save",
      description: "Save the active file",
      icon: <Save />,
      category: "File",
      commandId: "file.save",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("file.save");
      },
    },
    {
      id: "file-save-all",
      label: "File: Save All",
      description: "Save all modified files",
      icon: <Save />,
      category: "File",
      commandId: "file.saveAll",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("file.saveAll");
      },
    },
    {
      id: "file-save-as",
      label: "File: Save As",
      description: "Save current file with a new name",
      icon: <FilePlus />,
      category: "File",
      commandId: "file.saveAs",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("file.saveAs");
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
