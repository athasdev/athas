import {
  ArrowCounterClockwiseIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  GridIcon,
  HistoryIcon,
  SaveIcon,
  XIcon,
} from "@/ui/icons";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { openLocalHistoryForActiveFile } from "@/features/local-history/utils/open-local-history";
import type { Command } from "../types/keymaps.types";
import {
  closeActiveTab,
  closeAllTabs,
  closeCurrentWindow,
  closeOtherTabs,
  closeSavedTabs,
  closeTabsToLeft,
  closeTabsToRight,
  createNewFile,
  openFolderDialog,
  openProjectPicker,
  openQuickOpen,
  reopenClosedTab,
  revertActiveFile,
  saveActiveFile,
  saveActiveFileAs,
  saveAllFiles,
  showNewTab,
} from "./file-command-actions";
import { createNewWindow } from "./window-command-actions";

const openShare = () => import("@/features/sharing/services/open-share");

export const fileCommands: Command[] = [
  {
    id: "workbench.newTab",
    title: "New Tab",
    category: "File",
    execute: showNewTab,
  },
  {
    id: "workbench.newWindow",
    title: "New Window",
    category: "File",
    execute: createNewWindow,
  },
  {
    id: "file.save",
    title: "Save File",
    category: "File",
    description: "Save the active file",
    icon: <SaveIcon />,
    palette: { label: "File: Save" },
    execute: saveActiveFile,
  },
  {
    id: "file.saveAs",
    title: "Save File As",
    category: "File",
    description: "Save current file with a new name",
    icon: <FilePlusIcon />,
    palette: { label: "File: Save As" },
    execute: saveActiveFileAs,
  },
  {
    id: "file.saveAll",
    title: "Save All",
    category: "File",
    description: "Save all modified files",
    icon: <SaveIcon />,
    palette: { label: "File: Save All" },
    execute: saveAllFiles,
  },
  {
    id: "file.revert",
    title: "Revert File",
    category: "File",
    execute: revertActiveFile,
  },
  {
    id: "file.close",
    title: "Close Tab",
    category: "File",
    description: "Close current tab",
    icon: <XIcon />,
    // Cmd+W closes the window once no tab is left; the palette entry should never do that.
    when: ({ activeBuffer }) => activeBuffer !== null,
    palette: { label: "Tab: Close Tab" },
    execute: closeActiveTab,
  },
  {
    id: "workbench.closeWindow",
    title: "Close Window",
    category: "Workbench",
    execute: closeCurrentWindow,
  },
  {
    id: "file.closeAll",
    title: "Close All Tabs",
    category: "File",
    execute: closeAllTabs,
  },
  {
    id: "file.closeOthers",
    title: "Close Other Tabs",
    category: "File",
    execute: closeOtherTabs,
  },
  {
    id: "file.closeSaved",
    title: "Close Saved Tabs",
    category: "File",
    execute: closeSavedTabs,
  },
  {
    id: "file.closeTabsToLeft",
    title: "Close Tabs to the Left",
    category: "File",
    execute: closeTabsToLeft,
  },
  {
    id: "file.closeTabsToRight",
    title: "Close Tabs to the Right",
    category: "File",
    execute: closeTabsToRight,
  },
  {
    id: "file.reopenClosed",
    title: "Reopen Closed Tab",
    category: "File",
    description: "Reopen the most recently closed tab",
    icon: <ArrowCounterClockwiseIcon />,
    palette: { label: "Tab: Reopen Closed Tab", closePalette: "settled" },
    execute: reopenClosedTab,
  },
  {
    id: "file.new",
    title: "New File",
    category: "File",
    description: "Create a file in the current workspace",
    icon: <FilePlusIcon />,
    palette: { label: "File: New File" },
    execute: createNewFile,
  },
  {
    id: "file.newDocument",
    title: "File: New Document",
    category: "File",
    description: "Open an untitled document in the rich Markdown editor",
    icon: <FilePlusIcon />,
    palette: true,
    execute: () => {
      useBufferStore
        .getState()
        .actions.openContent({ type: "markdownDocument", documentId: crypto.randomUUID() });
    },
  },
  {
    id: "file.open",
    title: "Open Project",
    category: "File",
    description: "Open a folder or project",
    icon: <FolderOpenIcon />,
    palette: { label: "File: Open Project" },
    execute: openProjectPicker,
  },
  {
    id: "file.openFolder",
    title: "Open Folder",
    category: "File",
    description: "Choose a folder to open with the system dialog",
    icon: <FolderOpenIcon />,
    palette: { label: "File: Open Folder" },
    execute: openFolderDialog,
  },
  {
    id: "file.quickOpen",
    title: "Quick Open",
    category: "File",
    description: "Jump to any file with fuzzy search",
    icon: <FileTextIcon />,
    palette: { label: "Go: Quick Open", category: "Navigation" },
    execute: openQuickOpen,
  },
  {
    id: "file.localHistory",
    title: "Show Local History",
    category: "File",
    description: "Open the selected file timeline",
    icon: <HistoryIcon />,
    palette: { label: "File: Show Local History" },
    execute: openLocalHistoryForActiveFile,
  },
  {
    id: "workspace.manage",
    title: "Workspace: Manage Workspaces",
    category: "File",
    description: "Share project commands and AI instructions with your team",
    icon: <GridIcon />,
    palette: true,
    execute: async () => {
      const { openWorkspaceManagement } =
        await import("@/features/workspace/team/services/open-workspace-management");
      openWorkspaceManagement();
    },
  },
  {
    id: "share.buffer",
    title: "File: Share Buffer to Web",
    category: "File",
    description: "Create a read-only snapshot link",
    icon: <FilePlusIcon />,
    palette: true,
    execute: async () => {
      (await openShare()).shareEditor();
    },
  },
  {
    id: "share.selection",
    title: "File: Share Selection to Web",
    category: "File",
    description: "Share the selected code",
    icon: <FilePlusIcon />,
    palette: true,
    execute: async () => {
      (await openShare()).shareEditor(true);
    },
  },
  {
    id: "share.agent",
    title: "AI: Share Agent to Web",
    category: "AI",
    description: "Share the current conversation",
    icon: <FilePlusIcon />,
    palette: true,
    execute: async () => {
      await (await openShare()).shareAgent();
    },
  },
];
