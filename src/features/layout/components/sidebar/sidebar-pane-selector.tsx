import { Folder, GitBranch, GitPullRequest, Search } from "lucide-react";
import type { CoreFeaturesState } from "@/features/settings/types/feature";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import { Tabs, type TabsItem } from "@/ui/tabs";
import type { SidebarView } from "../../utils/sidebar-pane-utils";

interface SidebarPaneSelectorProps {
  activeSidebarView: SidebarView;
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  coreFeatures: CoreFeaturesState;
  onViewChange: (view: SidebarView) => void;
  onSearchClick?: () => void;
  compact?: boolean;
}

export const SidebarPaneSelector = ({
  activeSidebarView,
  isGitViewActive,
  isGitHubPRsViewActive,
  coreFeatures,
  onViewChange,
  onSearchClick,
  compact = false,
}: SidebarPaneSelectorProps) => {
  const tooltipSide = compact ? "bottom" : "right";
  const isFilesActive = !isGitViewActive && !isGitHubPRsViewActive && activeSidebarView === "files";
  const extensionViews = useExtensionViews();

  const items: TabsItem[] = [
    {
      id: "files",
      icon: <Folder />,
      isActive: isFilesActive,
      onClick: () => onViewChange("files"),
      role: "tab",
      ariaLabel: "File Explorer",
      className: compact ? undefined : "w-8 rounded-md",
      tooltip: {
        content: "File Explorer",
        shortcut: "Mod+Shift+E",
        side: tooltipSide,
      },
    },
    ...(coreFeatures.search && onSearchClick
      ? [
          {
            id: "search",
            icon: <Search />,
            onClick: onSearchClick,
            ariaLabel: "Search",
            className: compact ? undefined : "w-8 rounded-md",
            tooltip: {
              content: "Search",
              shortcut: "Mod+Shift+F",
              side: tooltipSide,
            },
          } satisfies TabsItem,
        ]
      : []),
    ...(coreFeatures.git
      ? [
          {
            id: "git",
            icon: <GitBranch />,
            isActive: isGitViewActive,
            onClick: () => onViewChange("git"),
            role: "tab",
            ariaLabel: "Git Source Control",
            className: compact ? undefined : "w-8 rounded-md",
            tooltip: {
              content: "Source Control",
              shortcut: "Mod+Shift+G",
              side: tooltipSide,
            },
          } satisfies TabsItem,
        ]
      : []),
    ...(coreFeatures.github
      ? [
          {
            id: "github-prs",
            icon: <GitPullRequest />,
            isActive: isGitHubPRsViewActive,
            onClick: () => onViewChange("github-prs"),
            role: "tab",
            ariaLabel: "GitHub Pull Requests",
            className: compact ? undefined : "w-8 rounded-md",
            tooltip: {
              content: "Pull Requests",
              side: tooltipSide,
            },
          } satisfies TabsItem,
        ]
      : []),
    ...Array.from(extensionViews.values()).map(
      (view) =>
        ({
          id: view.id,
          icon: <DynamicIcon name={view.icon} />,
          isActive: activeSidebarView === view.id,
          onClick: () => onViewChange(view.id),
          role: "tab",
          ariaLabel: view.title,
          className: compact ? undefined : "w-8 rounded-md",
          tooltip: {
            content: view.title,
            side: tooltipSide,
          },
        }) satisfies TabsItem,
    ),
  ];

  return (
    <Tabs
      items={items}
      size={compact ? "xs" : "sm"}
      variant={compact ? "segmented" : "default"}
      className={compact ? undefined : "gap-0.5 p-1"}
    />
  );
};
