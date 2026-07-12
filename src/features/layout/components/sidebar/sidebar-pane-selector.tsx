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
import { SidebarListItem } from "@/ui/sidebar";
import {
  BoxIcon,
  GitBranchIcon,
  ExtensionsIcon,
  FilesIcon,
  GitPullRequestIcon,
  MagnifyingGlassIcon,
} from "@/ui/icons";
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
  isSidebarVisible?: boolean;
  coreFeatures: CoreFeaturesState;
  onViewChange: (view: SidebarView) => void;
  onSearchClick?: () => void;
  onExtensionsClick?: () => void;
  isSearchActive?: boolean;
  isExtensionsActive?: boolean;
  compact?: boolean;
  showLabels?: boolean;
  orientation?: "horizontal" | "vertical";
}

export const SidebarPaneSelector = ({
  activeSidebarView,
  isGitViewActive,
  isGitHubPRsViewActive,
  isSidebarVisible = true,
  coreFeatures,
  onViewChange,
  onSearchClick,
  onExtensionsClick,
  isSearchActive = false,
  isExtensionsActive = false,
  compact = false,
  showLabels = false,
  orientation = "horizontal",
}: SidebarPaneSelectorProps) => {
  const isVertical = orientation === "vertical";
  const tooltipSide = isVertical ? "right" : "bottom";
  const iconClassName = compact || isVertical ? "size-4" : undefined;
  const tabClassName = compact
    ? chromeControl({ shape: "sidebar" })
    : chromeControl({ shape: "tab" });
  const isBufferOwnedSurfaceActive = isSearchActive || isExtensionsActive;
  const isPrimarySidebarItemActive = isSidebarVisible && !isBufferOwnedSurfaceActive;
  const isFilesActive =
    isPrimarySidebarItemActive &&
    !isGitViewActive &&
    !isGitHubPRsViewActive &&
    activeSidebarView === "files";
  const extensionViews = useExtensionViews();
  const sidebarActivityItemsOrder = useSettingsStore(
    (state) => state.settings.sidebarActivityItemsOrder,
  );

  const items = useMemo<TabsItem[]>(
    () => [
      {
        id: "files",
        label: showLabels ? "Files" : undefined,
        icon: <FilesIcon className={iconClassName} />,
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
              label: showLabels ? "Search" : undefined,
              icon: <MagnifyingGlassIcon className={iconClassName} />,
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
              label: showLabels ? "Source Control" : undefined,
              icon: <GitBranchIcon className={iconClassName} />,
              isActive: isPrimarySidebarItemActive && isGitViewActive,
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
              label: showLabels ? "Pull Requests" : undefined,
              icon: <GitPullRequestIcon className={iconClassName} />,
              isActive: isPrimarySidebarItemActive && isGitHubPRsViewActive,
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
              label: showLabels ? "Docker" : undefined,
              icon: <BoxIcon className={iconClassName} />,
              isActive: isPrimarySidebarItemActive && activeSidebarView === "docker",
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
        label: showLabels ? "Extensions" : undefined,
        icon: <ExtensionsIcon className={iconClassName} />,
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
            label: showLabels ? view.title : undefined,
            icon: <DynamicIcon name={view.icon} className={iconClassName} />,
            isActive: isPrimarySidebarItemActive && activeSidebarView === view.id,
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
      isPrimarySidebarItemActive,
      isGitHubPRsViewActive,
      isGitViewActive,
      isSearchActive,
      isExtensionsActive,
      isSidebarVisible,
      onExtensionsClick,
      onSearchClick,
      onViewChange,
      showLabels,
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

  if (isVertical) {
    return (
      <>
        {orderedItems.map((item) => (
          <SidebarListItem
            key={item.id}
            active={!!item.isActive}
            leading={item.icon}
            iconOnly={!showLabels}
            onClick={item.onClick}
            aria-label={item.ariaLabel}
            aria-current={item.isActive ? "page" : undefined}
            title={!showLabels ? (item.tooltip?.content ?? item.ariaLabel ?? item.id) : undefined}
            className="ui-text-sm min-h-6 py-1"
          >
            {item.label ?? item.tooltip?.content ?? item.ariaLabel ?? item.id}
          </SidebarListItem>
        ))}
      </>
    );
  }

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
        labelPosition="center"
        className={item.className}
        onClick={item.onClick}
      >
        {item.icon}
        {item.label ? (
          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        ) : null}
      </Tab>
    );

    const content =
      item.tooltip && !showLabels ? (
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
        isVertical &&
          cn(
            "flex-col rounded-none border-0 bg-transparent p-0",
            showLabels ? "w-full items-stretch gap-1" : "items-center gap-1",
          ),
      )}
    >
      {renderedItems.map((item) => (
        <Fragment key={item.id}>{item.content}</Fragment>
      ))}
    </TabsList>
  );
};
