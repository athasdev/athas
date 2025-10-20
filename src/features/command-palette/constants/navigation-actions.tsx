import { Cloud, FileText, FolderOpen, GitBranch, Hash, Package, Search } from "lucide-react";
import type { Action } from "../models/action.types";

interface NavigationActionsParams {
  setIsSidebarVisible: (v: boolean) => void;
  setActiveView: (view: "files" | "git" | "search" | "remote" | "extensions") => void;
  setIsCommandBarVisible: (v: boolean) => void;
  onClose: () => void;
}

export const createNavigationActions = (params: NavigationActionsParams): Action[] => {
  const { setIsSidebarVisible, setActiveView, setIsCommandBarVisible, onClose } = params;

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
      id: "view-show-search",
      label: "View: Show Search",
      description: "Switch to project search view",
      icon: <Search size={14} />,
      category: "Navigation",
      keybinding: ["⌘", "⇧", "F"],
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("search");
        onClose();
      },
    },
    {
      id: "view-show-remote",
      label: "View: Show Remote",
      description: "Switch to remote development view",
      icon: <Cloud size={14} />,
      category: "Navigation",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("remote");
        onClose();
      },
    },
    {
      id: "view-show-extensions",
      label: "View: Show Extensions",
      description: "Switch to extensions view",
      icon: <Package size={14} />,
      category: "Navigation",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("extensions");
        onClose();
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
      id: "go-to-file",
      label: "Go: Go to File",
      description: "Open file picker",
      icon: <FileText size={14} />,
      category: "Navigation",
      keybinding: ["⌘", "P"],
      action: () => {
        onClose();
        setIsCommandBarVisible(true);
      },
    },
  ];
};
