import { Fragment, useCallback, useMemo, type ReactNode } from "react";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import { normalizeItemOrder } from "@/features/layout/config/item-order";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/ui/dropdown";
import { SidebarListItem, SidebarListMenuItem } from "@/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import {
  AppStackFillDuoIcon,
  BoxFillDuoIcon,
  ChatCircleTextIcon,
  ClockCounterClockwiseIcon,
  CodeBranchFillDuoIcon,
  CodePullRequestFillDuoIcon,
  FilesFillDuoIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitDiffIcon,
  GitPullRequestIcon,
  LightningIcon,
  MagnifierFillDuoIcon,
  NodesIcon,
  TableFillDuoIcon,
} from "@/ui/icons";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import type { SidebarView } from "../../utils/sidebar-pane-utils";

interface SidebarPaneItem {
  id: string;
  label?: ReactNode;
  icon?: ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
  submenuItems?: Array<{
    id: string;
    label: string;
    icon?: ReactNode;
    separatorBefore?: boolean;
    onClick: () => void;
  }>;
  tooltip?: {
    content: string;
    shortcut?: string;
    side?: "top" | "bottom" | "left" | "right";
  };
}

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
  isSearchActive?: boolean;
  onExtensionsClick: () => void;
  isExtensionsActive: boolean;
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
  isSearchActive = false,
  onExtensionsClick,
  isExtensionsActive = false,
  compact = false,
  showLabels = false,
  orientation = "horizontal",
}: SidebarPaneSelectorProps) => {
  const isVertical = orientation === "vertical";
  const tooltipSide = isVertical ? "right" : "bottom";
  const iconClassName = compact || isVertical ? "size-4" : undefined;
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
  const hiddenSidebarActivityItems = useSettingsStore(
    (state) => state.settings.hiddenSidebarActivityItems,
  );

  const openGitSubview = useCallback(
    (detail: unknown) => {
      onViewChange("git");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("athas:git-palette-action", { detail }));
      }, 0);
    },
    [onViewChange],
  );

  const openGitHubSubview = useCallback(
    (section: "pull-requests" | "issues" | "actions") => {
      const settingBySection = {
        "pull-requests": "showGitHubPullRequests",
        issues: "showGitHubIssues",
        actions: "showGitHubActions",
      } as const;

      onViewChange("github-prs");
      void (async () => {
        const settingKey = settingBySection[section];
        const settingsStore = useSettingsStore.getState();
        if (!settingsStore.settings[settingKey]) {
          await settingsStore.actions.updateSetting(settingKey, true);
        }
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("athas:github-palette-action", {
              detail: { type: "show-section", section },
            }),
          );
        }, 0);
      })();
    },
    [onViewChange],
  );

  const items = useMemo<SidebarPaneItem[]>(
    () => [
      {
        id: "files",
        label: showLabels ? "Files" : undefined,
        icon: <FilesFillDuoIcon className={cn(iconClassName, "text-primary")} />,
        isActive: isFilesActive,
        onClick: () => onViewChange("files"),
        ariaLabel: "Files",
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
              icon: <MagnifierFillDuoIcon className={cn(iconClassName, "text-info")} />,
              isActive: isSearchActive,
              onClick: onSearchClick,
              ariaLabel: "Search",
              tooltip: {
                content: "Search",
                shortcut: "Mod+Shift+F",
                side: tooltipSide,
              },
            } satisfies SidebarPaneItem,
          ]
        : []),
      ...(coreFeatures.git
        ? [
            {
              id: "git",
              label: showLabels ? "Source Control" : undefined,
              icon: <CodeBranchFillDuoIcon className={cn(iconClassName, "text-success")} />,
              isActive: isPrimarySidebarItemActive && isGitViewActive,
              onClick: () => onViewChange("git"),
              submenuItems: [
                {
                  id: "changes",
                  label: "Changes",
                  icon: <GitDiffIcon />,
                  onClick: () => openGitSubview({ type: "show-tab", tab: "changes" }),
                },
                {
                  id: "history",
                  label: "History",
                  icon: <ClockCounterClockwiseIcon />,
                  onClick: () => openGitSubview({ type: "show-tab", tab: "history" }),
                },
                {
                  id: "repositories",
                  label: "Repositories",
                  icon: <FolderOpenIcon />,
                  separatorBefore: true,
                  onClick: () => openGitSubview({ type: "manage-branches", tab: "repositories" }),
                },
                {
                  id: "branches",
                  label: "Branches",
                  icon: <GitBranchIcon />,
                  onClick: () => openGitSubview({ type: "manage-branches", tab: "branches" }),
                },
                {
                  id: "worktrees",
                  label: "Worktrees",
                  icon: <NodesIcon />,
                  onClick: () => openGitSubview({ type: "manage-branches", tab: "worktrees" }),
                },
              ],
              ariaLabel: "Git Source Control",
              tooltip: {
                content: "Source Control",
                shortcut: "Mod+Shift+G",
                side: tooltipSide,
              },
            } satisfies SidebarPaneItem,
          ]
        : []),
      ...(coreFeatures.github
        ? [
            {
              id: "github-prs",
              label: showLabels ? "Pull Requests" : undefined,
              icon: <CodePullRequestFillDuoIcon className={cn(iconClassName, "text-primary")} />,
              isActive: isPrimarySidebarItemActive && isGitHubPRsViewActive,
              onClick: () => onViewChange("github-prs"),
              submenuItems: [
                {
                  id: "pull-requests",
                  label: "Pull Requests",
                  icon: <GitPullRequestIcon />,
                  onClick: () => openGitHubSubview("pull-requests"),
                },
                {
                  id: "issues",
                  label: "Issues",
                  icon: <ChatCircleTextIcon />,
                  onClick: () => openGitHubSubview("issues"),
                },
                {
                  id: "actions",
                  label: "Actions",
                  icon: <LightningIcon />,
                  onClick: () => openGitHubSubview("actions"),
                },
              ],
              ariaLabel: "GitHub Pull Requests",
              tooltip: {
                content: "Pull Requests",
                side: tooltipSide,
              },
            } satisfies SidebarPaneItem,
          ]
        : []),
      {
        id: "data-sources",
        label: showLabels ? "Data Sources" : undefined,
        icon: <TableFillDuoIcon className={cn(iconClassName, "text-warning")} />,
        isActive: isPrimarySidebarItemActive && activeSidebarView === "data-sources",
        onClick: () => onViewChange("data-sources"),
        ariaLabel: "Data Sources",
        tooltip: {
          content: "Data Sources",
          side: tooltipSide,
        },
      },
      ...(coreFeatures.docker
        ? [
            {
              id: "docker",
              label: showLabels ? "Docker" : undefined,
              icon: <BoxFillDuoIcon className={cn(iconClassName, "text-info")} />,
              isActive: isPrimarySidebarItemActive && activeSidebarView === "docker",
              onClick: () => onViewChange("docker"),
              ariaLabel: "Docker",
              tooltip: {
                content: "Docker",
                side: tooltipSide,
              },
            } satisfies SidebarPaneItem,
          ]
        : []),
      {
        id: "extensions",
        label: showLabels ? "Extensions" : undefined,
        icon: <AppStackFillDuoIcon className={cn(iconClassName, "text-warning")} />,
        isActive: isExtensionsActive,
        onClick: onExtensionsClick,
        ariaLabel: "Extensions",
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
            ariaLabel: view.title,
            tooltip: {
              content: view.title,
              side: tooltipSide,
            },
          }) satisfies SidebarPaneItem,
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
      openGitHubSubview,
      openGitSubview,
      onSearchClick,
      onExtensionsClick,
      onViewChange,
      showLabels,
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
  const visibleItems = orderedItems.filter((item) => !hiddenSidebarActivityItems.includes(item.id));

  if (isVertical) {
    return (
      <nav
        aria-label="Activity views"
        className="flex w-full flex-col gap-(--athas-chrome-gap-tight)"
      >
        {visibleItems.map((item) => {
          const label = item.label ?? item.tooltip?.content ?? item.ariaLabel ?? item.id;

          if (item.submenuItems?.length) {
            return (
              <SidebarListMenuItem
                key={item.id}
                active={!!item.isActive}
                appearance="activity"
                leading={item.icon}
                iconOnly={!showLabels}
                onClick={item.onClick}
                aria-label={item.ariaLabel}
                aria-current={item.isActive ? "page" : undefined}
                title={
                  !showLabels ? (item.tooltip?.content ?? item.ariaLabel ?? item.id) : undefined
                }
                menuLabel={`Choose ${item.tooltip?.content ?? label} view`}
                menu={item.submenuItems.map((submenuItem) => (
                  <Fragment key={submenuItem.id}>
                    {submenuItem.separatorBefore ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem onClick={submenuItem.onClick}>
                      {submenuItem.icon}
                      {submenuItem.label}
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              >
                {label}
              </SidebarListMenuItem>
            );
          }

          return (
            <SidebarListItem
              key={item.id}
              active={!!item.isActive}
              appearance="activity"
              leading={item.icon}
              iconOnly={!showLabels}
              onClick={item.onClick}
              aria-label={item.ariaLabel}
              aria-current={item.isActive ? "page" : undefined}
              title={!showLabels ? (item.tooltip?.content ?? item.ariaLabel ?? item.id) : undefined}
            >
              {label}
            </SidebarListItem>
          );
        })}
      </nav>
    );
  }

  const renderedItems = visibleItems.map((item) => {
    const tabNode = (
      <TabsTrigger
        value={item.id}
        aria-label={item.ariaLabel}
        size={compact ? "xs" : "sm"}
        className={cn(
          compact && "aspect-7/6 flex-none px-0",
          !compact && "flex-none",
          item.className,
        )}
      >
        {item.icon}
        {item.label ? (
          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        ) : null}
      </TabsTrigger>
    );

    const content =
      item.tooltip && !showLabels ? (
        <Tooltip
          content={item.tooltip.content}
          shortcut={item.tooltip.shortcut}
          side={item.tooltip.side}
        >
          {tabNode}
        </Tooltip>
      ) : (
        tabNode
      );

    return {
      id: item.id,
      content,
    };
  });

  return (
    <Tabs
      value={visibleItems.find((item) => item.isActive)?.id}
      onValueChange={(value) => visibleItems.find((item) => item.id === value)?.onClick?.()}
      className="gap-0"
    >
      <TabsList
        variant={compact ? "bare" : "default"}
        className={cn(!compact && "gap-0.5 p-1")}
        aria-label="Sidebar views"
      >
        {renderedItems.map((item) => (
          <span key={item.id} className="contents">
            {item.content}
          </span>
        ))}
      </TabsList>
    </Tabs>
  );
};
