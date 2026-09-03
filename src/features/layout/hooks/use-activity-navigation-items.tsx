import { useMemo, type ReactNode } from "react";
import { normalizeItemOrder } from "@/features/layout/config/item-order";
import type { SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import {
  BoxIcon,
  BugBeetleIcon,
  DatabaseIcon,
  ExtensionsIcon,
  FilesIcon,
  GitBranchIcon,
  GithubLogoIcon,
  StackIcon as LayersIcon,
} from "@/ui/icons";

export interface ActivityNavigationItem {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  shortcut?: string;
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
  isDebuggerActive: boolean;
  isDatabasesActive: boolean;
  onToggleDebugger: () => void;
  onOpenDatabases: () => void;
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
  isDebuggerActive,
  isDatabasesActive,
  onToggleDebugger,
  onOpenDatabases,
}: ActivityNavigationItemOptions) {
  const extensionViews = useExtensionViews();
  const sidebarActivityItemsOrder = useSettingsStore(
    (state) => state.settings.sidebarActivityItemsOrder,
  );
  const isBufferOwnedSurfaceActive = isExtensionsActive;
  const isPrimarySidebarItemActive = isSidebarVisible && !isBufferOwnedSurfaceActive;

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
      ...(coreFeatures.debugger
        ? [
            {
              id: "debugger",
              label: "Run and Debug",
              icon: <BugBeetleIcon />,
              active: isDebuggerActive,
              onClick: onToggleDebugger,
              ariaLabel: "Run and Debug",
              shortcut: "Mod+Shift+D",
            } satisfies ActivityNavigationItem,
          ]
        : []),
      {
        id: "databases",
        label: "Databases",
        icon: <DatabaseIcon />,
        active: isDatabasesActive,
        onClick: onOpenDatabases,
        ariaLabel: "Databases",
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
      coreFeatures.debugger,
      coreFeatures.docker,
      coreFeatures.git,
      coreFeatures.github,
      extensionViews,
      isExtensionsActive,
      isDatabasesActive,
      isDebuggerActive,
      isGitHubPRsViewActive,
      isGitViewActive,
      isPrimarySidebarItemActive,
      onOpenExtensions,
      onOpenDatabases,
      onToggleDebugger,
      onViewChange,
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
