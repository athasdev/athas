import {
  FileText,
  FolderOpen,
  BugBeetle,
  GitBranch,
  GitPullRequest,
  Hash,
  Package,
  MagnifyingGlass as Search,
} from "@phosphor-icons/react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { SettingsTab } from "@/features/window/stores/ui-state/types";
import type { Action } from "../models/action.types";

interface NavigationActionsParams {
  setIsSidebarVisible: (v: boolean) => void;
  setActiveView: (view: "files" | "git" | "github-prs" | "debugger") => void;
  setIsQuickOpenVisible: (v: boolean) => void;
  openSettingsDialog: (tab?: SettingsTab) => void;
  onClose: () => void;
}

export const createNavigationActions = (params: NavigationActionsParams): Action[] => {
  const { setIsSidebarVisible, setActiveView, setIsQuickOpenVisible, openSettingsDialog, onClose } =
    params;

  return [
    {
      id: "view-show-files",
      label: "View: Show Files",
      description: "Switch to files view",
      icon: <FolderOpen />,
      category: "Navigation",
      commandId: "workbench.showFileExplorer",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("files");
        onClose();
      },
    },
    {
      id: "view-show-git",
      label: "View: Show Git",
      description: "Switch to Git view",
      icon: <GitBranch />,
      category: "Navigation",
      commandId: "workbench.showSourceControl",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("git");
        onClose();
      },
    },
    {
      id: "view-show-github-prs",
      label: "View: Show Pull Requests",
      description: "Switch to GitHub Pull Requests view",
      icon: <GitPullRequest />,
      category: "Navigation",
      commandId: "workbench.showGitHub",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("github-prs");
        onClose();
      },
    },
    {
      id: "view-show-debugger",
      label: "View: Show Run and Debug",
      description: "Switch to debugger view",
      icon: <BugBeetle />,
      category: "Navigation",
      commandId: "workbench.showDebugger",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("debugger");
        onClose();
      },
    },
    {
      id: "search-global",
      label: "Search: Global Search",
      description: "Search across files in workspace",
      icon: <Search />,
      category: "Navigation",
      commandId: "workbench.showGlobalSearch",
      action: () => {
        onClose();
        useBufferStore.getState().actions.openGlobalSearchBuffer();
      },
    },
    {
      id: "view-show-extensions",
      label: "View: Show Extensions",
      description: "Open extensions in settings",
      icon: <Package />,
      category: "Navigation",
      action: () => {
        onClose();
        openSettingsDialog("extensions");
      },
    },
    {
      id: "go-to-line",
      label: "Go: Go to Line",
      description: "Jump to a specific line number",
      icon: <Hash />,
      category: "Navigation",
      commandId: "editor.goToLine",
      action: () => {
        onClose();
        window.dispatchEvent(new CustomEvent("menu-go-to-line"));
      },
    },
    {
      id: "quick-open",
      label: "Go: Quick Open",
      description: "Jump to any file with fuzzy search",
      icon: <FileText />,
      category: "Navigation",
      commandId: "file.quickOpen",
      action: () => {
        onClose();
        setIsQuickOpenVisible(true);
      },
    },
  ];
};
