import { shareEditor, shareAgent } from "@/features/sharing/services/open-share";
import { FilePlusIcon, FolderOpenIcon, HistoryIcon, SaveIcon } from "@/ui/icons";
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
      id: "share-buffer",
      label: "File: Share Buffer to Web",
      description: "Create a read-only snapshot link",
      category: "File",
      icon: <FilePlusIcon />,
      action: () => {
        onClose();
        shareEditor();
      },
    },
    {
      id: "share-selection",
      label: "File: Share Selection to Web",
      description: "Share the selected code",
      category: "File",
      icon: <FilePlusIcon />,
      action: () => {
        onClose();
        shareEditor(true);
      },
    },
    {
      id: "share-agent",
      label: "AI: Share Agent to Web",
      description: "Share the current conversation",
      category: "AI",
      icon: <FilePlusIcon />,
      action: () => {
        onClose();
        shareAgent();
      },
    },
    {
      id: "file-new",
      label: "File: New File",
      description: "Create a file in the current workspace",
      icon: <FilePlusIcon />,
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
      icon: <FilePlusIcon />,
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
      icon: <FolderOpenIcon />,
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
      icon: <SaveIcon />,
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
      icon: <SaveIcon />,
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
      icon: <FilePlusIcon />,
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
      icon: <HistoryIcon />,
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
