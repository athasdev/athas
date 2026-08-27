import { useCallback, useMemo, type ReactNode } from "react";
import { normalizeItemOrder } from "@/features/layout/config/item-order";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import {
  BoxIcon,
  ChatCircleTextIcon,
  ClockCounterClockwiseIcon,
  ExtensionsIcon,
  FilesIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitDiffIcon,
  GitPullRequestIcon,
  GithubLogoIcon,
  LightningIcon,
  NodesIcon,
  StackIcon as LayersIcon,
} from "@/ui/icons";

export interface ActivityNavigationSubmenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  separatorBefore?: boolean;
  onClick: () => void;
}

export interface ActivityNavigationItem {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  shortcut?: string;
  submenuItems?: ActivityNavigationSubmenuItem[];
}

interface ActivityNavigationItemOptions {
  activeSidebarView: SidebarView;
  isGitViewActive: boolean;
  isGitHubPRsViewActive: boolean;
  isSidebarVisible: boolean;
  coreFeatures: CoreFeaturesState;
  onViewChange: (view: SidebarView) => void;
  onOpenExtensions: () => void;
  isExtensionsActive: boolean;
}

function orderItems<T extends { id: string }>(items: T[], orderedIds: string[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is T => Boolean(item));
  const orderedIdSet = new Set(orderedIds);
  return [...orderedItems, ...items.filter((item) => !orderedIdSet.has(item.id))];
}

export function useActivityNavigationItems({
  activeSidebarView,
  isGitViewActive,
  isGitHubPRsViewActive,
  isSidebarVisible,
  coreFeatures,
  onViewChange,
  onOpenExtensions,
  isExtensionsActive,
}: ActivityNavigationItemOptions) {
  const extensionViews = useExtensionViews();
  const sidebarActivityItemsOrder = useSettingsStore(
    (state) => state.settings.sidebarActivityItemsOrder,
  );
  const isBufferOwnedSurfaceActive = isExtensionsActive;
  const isPrimarySidebarItemActive = isSidebarVisible && !isBufferOwnedSurfaceActive;

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

  const items = useMemo<ActivityNavigationItem[]>(
    () => [
      {
        id: "files",
        label: "Files",
        icon: <FilesIcon />,
        active:
          isPrimarySidebarItemActive &&
          !isGitViewActive &&
          !isGitHubPRsViewActive &&
          activeSidebarView === "files",
        onClick: () => onViewChange("files"),
        ariaLabel: "Files",
        shortcut: "Mod+Shift+E",
      },
      ...(coreFeatures.git
        ? [
            {
              id: "git",
              label: "Source Control",
              icon: <GitBranchIcon />,
              active: isPrimarySidebarItemActive && isGitViewActive,
              onClick: () => onViewChange("git"),
              ariaLabel: "Git Source Control",
              shortcut: "Mod+Shift+G",
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
            } satisfies ActivityNavigationItem,
          ]
        : []),
      ...(coreFeatures.github
        ? [
            {
              id: "github-prs",
              label: "GitHub",
              icon: <GithubLogoIcon />,
              active: isPrimarySidebarItemActive && isGitHubPRsViewActive,
              onClick: () => onViewChange("github-prs"),
              ariaLabel: "GitHub",
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
            } satisfies ActivityNavigationItem,
          ]
        : []),
      {
        id: "views",
        label: "Views",
        icon: <LayersIcon />,
        active: isPrimarySidebarItemActive && activeSidebarView === "views",
        onClick: () => onViewChange("views"),
        ariaLabel: "Views",
      },
      ...(coreFeatures.docker
        ? [
            {
              id: "docker",
              label: "Docker",
              icon: <BoxIcon />,
              active: isPrimarySidebarItemActive && activeSidebarView === "docker",
              onClick: () => onViewChange("docker"),
              ariaLabel: "Docker",
            } satisfies ActivityNavigationItem,
          ]
        : []),
      {
        id: "extensions",
        label: "Extensions",
        icon: <ExtensionsIcon />,
        active: isExtensionsActive,
        onClick: onOpenExtensions,
        ariaLabel: "Extensions",
      },
      ...Array.from(extensionViews.values()).map(
        (view) =>
          ({
            id: view.id,
            label: view.title,
            icon: <DynamicIcon name={view.icon} />,
            active: isPrimarySidebarItemActive && activeSidebarView === view.id,
            onClick: () => onViewChange(view.id),
            ariaLabel: view.title,
          }) satisfies ActivityNavigationItem,
      ),
    ],
    [
      activeSidebarView,
      coreFeatures.docker,
      coreFeatures.git,
      coreFeatures.github,
      extensionViews,
      isExtensionsActive,
      isGitHubPRsViewActive,
      isGitViewActive,
      isPrimarySidebarItemActive,
      onOpenExtensions,
      onViewChange,
      openGitHubSubview,
      openGitSubview,
    ],
  );

  return useMemo(
    () =>
      orderItems(
        items,
        normalizeItemOrder(
          sidebarActivityItemsOrder,
          items.map((item) => item.id),
        ),
      ),
    [items, sidebarActivityItemsOrder],
  );
}
