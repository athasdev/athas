import {
  FolderIcon as Folder,
  GitBranchIcon as GitBranch,
  GitPullRequestIcon as GitPullRequest,
  MagnifyingGlassIcon as MagnifyingGlass,
  CubeIcon as Cube,
  PuzzlePieceIcon as PuzzlePiece,
} from "@phosphor-icons/react";
import { Fragment, useMemo } from "react";
import {
  chromeControl,
  chromeControlGroup,
} from "@/features/layout/components/chrome-control-styles";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import { normalizeItemOrder } from "@/features/layout/config/item-order";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Tab, TabsList, type TabsItem } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import type { SidebarView } from "../../utils/sidebar-pane-utils";

function orderItems<T extends { id: string }>(items: T[], orderedIds: string[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is T => Boolean(item));
  const orderedIdSet = new Set(orderedIds);
  const missingItems = items.filter((item) => !orderedIdSet.has(item.id));
  return [...orderedItems, ...missingItems];
}

interface SidebarPaneSelectorProps {
  activeSidebarView: SidebarView;
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  coreFeatures: CoreFeaturesState;
  onViewChange: (view: SidebarView) => void;
  onSearchClick?: () => void;
  onExtensionsClick?: () => void;
  isSearchActive?: boolean;
  isExtensionsActive?: boolean;
  compact?: boolean;
  orientation?: "horizontal" | "vertical";
}

export const SidebarPaneSelector = ({
  activeSidebarView,
  isGitViewActive,
  isGitHubPRsViewActive,
  coreFeatures,
  onViewChange,
  onSearchClick,
  onExtensionsClick,
  isSearchActive = false,
  isExtensionsActive = false,
  compact = false,
  orientation = "horizontal",
}: SidebarPaneSelectorProps) => {
  const isVertical = orientation === "vertical";
  const tooltipSide = isVertical ? "right" : "bottom";
  const iconClassName = compact ? "size-4" : isVertical ? "size-[18px]" : undefined;
  const tabClassName = compact
    ? chromeControl()
    : isVertical
      ? chromeControl({ shape: "sidebar" })
      : chromeControl({ shape: "tab" });
  const isFilesActive = !isGitViewActive && !isGitHubPRsViewActive && activeSidebarView === "files";
  const extensionViews = useExtensionViews();
  const sidebarActivityItemsOrder = useSettingsStore(
    (state) => state.settings.sidebarActivityItemsOrder,
  );

  const items = useMemo<TabsItem[]>(
    () => [
      {
        id: "files",
        icon: <Folder className={iconClassName} weight="duotone" />,
        isActive: isFilesActive,
        onClick: () => onViewChange("files"),
        role: "tab",
        ariaLabel: "Files",
        className: tabClassName,
        tooltip: {
          content: "Files",
          shortcut: "Mod+Shift+E",
          side: tooltipSide,
        },
      },
      ...(coreFeatures.search && onSearchClick
        ? [
            {
              id: "search",
              icon: <MagnifyingGlass className={iconClassName} weight="duotone" />,
              isActive: isSearchActive,
              onClick: onSearchClick,
              ariaLabel: "Search",
              className: tabClassName,
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
              icon: <GitBranch className={iconClassName} weight="duotone" />,
              isActive: isGitViewActive,
              onClick: () => onViewChange("git"),
              role: "tab",
              ariaLabel: "Git Source Control",
              className: tabClassName,
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
              icon: <GitPullRequest className={iconClassName} weight="duotone" />,
              isActive: isGitHubPRsViewActive,
              onClick: () => onViewChange("github-prs"),
              role: "tab",
              ariaLabel: "GitHub Pull Requests",
              className: tabClassName,
              tooltip: {
                content: "Pull Requests",
                side: tooltipSide,
              },
            } satisfies TabsItem,
          ]
        : []),
      ...(coreFeatures.docker
        ? [
            {
              id: "docker",
              icon: <Cube className={iconClassName} weight="duotone" />,
              isActive: activeSidebarView === "docker",
              onClick: () => onViewChange("docker"),
              role: "tab",
              ariaLabel: "Docker",
              className: tabClassName,
              tooltip: {
                content: "Docker",
                side: tooltipSide,
              },
            } satisfies TabsItem,
          ]
        : []),
      {
        id: "extensions",
        icon: <PuzzlePiece className={iconClassName} weight="duotone" />,
        isActive: isExtensionsActive,
        onClick: onExtensionsClick ?? (() => onViewChange("extensions")),
        ariaLabel: "Extensions",
        className: tabClassName,
        tooltip: {
          content: "Extensions",
          side: tooltipSide,
        },
      },
      ...Array.from(extensionViews.values()).map(
        (view) =>
          ({
            id: view.id,
            icon: <DynamicIcon name={view.icon} className={iconClassName} />,
            isActive: activeSidebarView === view.id,
            onClick: () => onViewChange(view.id),
            role: "tab",
            ariaLabel: view.title,
            className: tabClassName,
            tooltip: {
              content: view.title,
              side: tooltipSide,
            },
          }) satisfies TabsItem,
      ),
    ],
    [
      activeSidebarView,
      coreFeatures.git,
      coreFeatures.github,
      coreFeatures.docker,
      coreFeatures.search,
      extensionViews,
      iconClassName,
      isFilesActive,
      isGitHubPRsViewActive,
      isGitViewActive,
      isSearchActive,
      isExtensionsActive,
      onExtensionsClick,
      onSearchClick,
      onViewChange,
      tabClassName,
      tooltipSide,
    ],
  );

  const orderedIds = useMemo(
    () =>
      normalizeItemOrder(
        sidebarActivityItemsOrder,
        items.map((item) => item.id),
      ),
    [items, sidebarActivityItemsOrder],
  );

  const orderedItems = orderItems(items, orderedIds);

  const renderedItems = orderedItems.map((item) => {
    const tabNode = (
      <Tab
        role={item.role}
        aria-selected={item.isActive}
        aria-label={item.ariaLabel}
        tabIndex={item.tabIndex}
        title={item.title}
        isActive={!!item.isActive}
        size={compact ? "xs" : "sm"}
        variant="default"
        className={item.className}
        onClick={item.onClick}
      >
        {item.icon}
        {item.label}
      </Tab>
    );

    const content = item.tooltip ? (
      <Tooltip
        content={item.tooltip.content}
        shortcut={item.tooltip.shortcut}
        side={item.tooltip.side}
        className={item.tooltip.className}
      >
        {tabNode}
      </Tooltip>
    ) : (
      tabNode
    );

    return {
      id: item.id,
      label: item.tooltip?.content ?? item.ariaLabel ?? item.title ?? item.id,
      content,
    };
  });

  return (
    <TabsList
      variant="default"
      className={cn(
        compact ? chromeControlGroup() : "gap-0.5 p-1",
        isVertical && "flex-col items-center gap-1 rounded-none border-0 bg-transparent p-0",
      )}
    >
      {renderedItems.map((item) => (
        <Fragment key={item.id}>{item.content}</Fragment>
      ))}
    </TabsList>
  );
};
