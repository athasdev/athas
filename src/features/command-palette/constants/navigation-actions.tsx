import {
  FileTextIcon as FileText,
  FolderOpenIcon as FolderOpen,
  BugBeetleIcon as BugBeetle,
  GitBranchIcon as GitBranch,
  GitPullRequestIcon as GitPullRequest,
  ListBulletsIcon as ListBullets,
  ListChecksIcon as ListChecks,
  PackageIcon as Package,
  MagnifyingGlassIcon as Search,
  StackIcon as Views,
} from "@/ui/icons";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import { setOutlineVisibilityPreference } from "@/features/outline/actions/outline-visibility";
import type {
  BottomPaneTab,
  SettingsTab,
} from "@/features/window/stores/ui-state/types/ui-state.types";
import type { Action } from "../types/action.types";

interface NavigationActionsParams {
  setIsSidebarVisible: (v: boolean) => void;
  setActiveView: (view: SidebarView) => void;
  setIsBottomPaneVisible: (v: boolean) => void;
  setBottomPaneActiveTab: (tab: BottomPaneTab) => void;
  setIsQuickOpenVisible: (v: boolean) => void;
  openCommandPaletteView?: (view: "outline") => void;
  openSettingsDialog: (tab?: SettingsTab) => void;
  coreFeatures: { git: boolean; outline: boolean };
  onClose: () => void;
}

export const createNavigationActions = (params: NavigationActionsParams): Action[] => {
  const {
    setIsSidebarVisible,
    setActiveView,
    setIsBottomPaneVisible,
    setBottomPaneActiveTab,
    setIsQuickOpenVisible,
    openCommandPaletteView,
    coreFeatures,
    onClose,
  } = params;

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
    ...(coreFeatures.git
      ? [
          {
            id: "view-show-review",
            label: "Source Control: Show Review",
            description: "Open review checkpoints in Source Control",
            icon: <ListChecks />,
            category: "Navigation",
            action: () => {
              useSidebarStore.getState().actions.setGitSection("review");
              setIsSidebarVisible(true);
              setActiveView("git");
              window.setTimeout(() => {
                window.dispatchEvent(
                  new CustomEvent("athas:git-palette-action", {
                    detail: { type: "show-tab", tab: "review" },
                  }),
                );
              }, 0);
              onClose();
            },
          } satisfies Action,
        ]
      : []),
    {
      id: "view-show-views",
      label: "View: Show Views",
      description: "Switch to project custom views",
      icon: <Views />,
      category: "Navigation",
      commandId: "workbench.showViews",
      action: () => {
        setIsSidebarVisible(true);
        setActiveView("views");
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
        setBottomPaneActiveTab("debugger");
        setIsBottomPaneVisible(true);
        onClose();
      },
    },
    ...(coreFeatures.outline
      ? [
          {
            id: "view-show-outline",
            label: "View: Show Outline",
            description: "Show symbols for the active file in the sidebar",
            icon: <ListBullets />,
            category: "Navigation",
            commandId: "workbench.showOutline",
            action: () => {
              setOutlineVisibilityPreference(true);
              onClose();
            },
          } satisfies Action,
        ]
      : []),
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
      description: "Open the extensions tab",
      icon: <Package />,
      category: "Navigation",
      action: () => {
        onClose();
        useBufferStore.getState().actions.openExtensionsBuffer();
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
    {
      id: "go-to-symbol-in-editor",
      label: "Go: Symbol in Editor",
      description: "Open the active file outline picker",
      icon: <ListBullets />,
      category: "Navigation",
      commandId: "editor.showOutline",
      action: () => {
        onClose();
        openCommandPaletteView?.("outline");
      },
    },
  ];
};
