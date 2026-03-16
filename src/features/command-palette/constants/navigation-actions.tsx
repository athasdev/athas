import {
  FileText,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  Hash,
  Package,
  Search,
} from "lucide-react";
import type { SettingsTab } from "@/features/window/stores/ui-state/types";
import type { Action } from "../models/action.types";

interface NavigationActionsParams {
  setIsSidebarVisible: (v: boolean) => void;
  setActiveView: (view: "files" | "git" | "github-prs") => void;
  setIsQuickOpenVisible: (v: boolean) => void;
  setIsGlobalSearchVisible: (v: boolean) => void;
  openSettingsDialog: (tab?: SettingsTab) => void;
  onClose: () => void;
}

export const createNavigationActions = (params: NavigationActionsParams): Action[] => {
  const {
    setIsSidebarVisible,
    setActiveView,
    setIsQuickOpenVisible,
    setIsGlobalSearchVisible,
    openSettingsDialog,
    onClose,
  } = params;

  return [
    {
      id: "view-show-files",
      label: "View: Show Files",
      description: "Switch to files explorer view",
      icon: <FolderOpen size={14} />,
      category: "Navigation",
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
      icon: <GitBranch size={14} />,
      category: "Navigation",
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
      icon: <GitPullRequest size={14} />,
      category: "Navigation",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("github-prs");
        onClose();
      },
    },
    {
      id: "search-global",
      label: "Search: Global Search",
      description: "Search across files in workspace",
      icon: <Search size={14} />,
      category: "Navigation",
      keybinding: ["⌘", "⇧", "F"],
      action: () => {
        onClose();
        setIsGlobalSearchVisible(true);
      },
    },
    {
      id: "view-show-extensions",
      label: "View: Show Extensions",
      description: "Open extensions in settings",
      icon: <Package size={14} />,
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
      icon: <Hash size={14} />,
      category: "Navigation",
      keybinding: ["⌘", "G"],
      action: () => {
        onClose();
        window.dispatchEvent(new CustomEvent("menu-go-to-line"));
      },
    },
    {
      id: "quick-open",
      label: "Go: Quick Open",
      description: "Jump to any file with fuzzy search",
      icon: <FileText size={14} />,
      category: "Navigation",
      keybinding: ["⌘", "P"],
      action: () => {
        onClose();
        setIsQuickOpenVisible(true);
      },
    },
  ];
};
