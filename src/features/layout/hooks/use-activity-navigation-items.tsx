import { useCallback, useMemo, type ReactNode } from "react";
import { normalizeItemOrder } from "@/features/layout/config/item-order";
import {
  type DockerActivitySection,
  type GitActivitySection,
  type GitHubActivitySection,
  useSidebarStore,
} from "@/features/layout/stores/sidebar.store";
import {
  shouldOpenSidebarSubview,
  type SidebarView,
} from "@/features/layout/utils/sidebar-pane-utils";
import type { CoreFeaturesState } from "@/features/settings/types/feature.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import {
  BoxIcon,
  ChatCircleTextIcon,
  CloudArrowDownIcon,
  ClockCounterClockwiseIcon,
  CubeIcon,
  ExtensionsIcon,
  FilesIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitDiffIcon,
  GitPullRequestIcon,
  GithubLogoIcon,
  LightningIcon,
  ListChecksIcon,
  NodesIcon,
  StackIcon as LayersIcon,
} from "@/ui/icons";

export interface ActivityNavigationSubmenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
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

type GitNavigationAction =
  | { type: "show-tab"; tab: GitActivitySection }
  | { type: "manage-branches"; tab: "repositories" | "branches" | "worktrees" };

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
  const gitSidebarTabOrder = useSettingsStore((state) => state.settings.gitSidebarTabOrder);
  const githubSidebarSectionOrder = useSettingsStore(
    (state) => state.settings.githubSidebarSectionOrder,
  );
  const gitSection = useSidebarStore.use.gitSection();
  const githubSection = useSidebarStore.use.githubSection();
  const dockerSection = useSidebarStore.use.dockerSection();
  const { setGitSection, setGitHubSection, setDockerSection } = useSidebarStore.use.actions();
  const isBufferOwnedSurfaceActive = isExtensionsActive;
  const isPrimarySidebarItemActive = isSidebarVisible && !isBufferOwnedSurfaceActive;

  const openGitSubview = useCallback(
    (detail: GitNavigationAction) => {
      if (detail.type === "show-tab") setGitSection(detail.tab);
      if (shouldOpenSidebarSubview(isSidebarVisible, isGitViewActive)) onViewChange("git");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("athas:git-palette-action", { detail }));
      }, 0);
    },
    [isGitViewActive, isSidebarVisible, onViewChange, setGitSection],
  );

  const openGitHubSubview = useCallback(
    (section: "pull-requests" | "issues" | "actions") => {
      const settingBySection = {
        "pull-requests": "showGitHubPullRequests",
        issues: "showGitHubIssues",
        actions: "showGitHubActions",
      } as const;

      setGitHubSection(section);
      if (shouldOpenSidebarSubview(isSidebarVisible, isGitHubPRsViewActive)) {
        onViewChange("github-prs");
      }
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
    [isGitHubPRsViewActive, isSidebarVisible, onViewChange, setGitHubSection],
  );

  const openDockerSubview = useCallback(
    (section: DockerActivitySection) => {
      setDockerSection(section);
      if (shouldOpenSidebarSubview(isSidebarVisible, activeSidebarView === "docker")) {
        onViewChange("docker");
      }
    },
    [activeSidebarView, isSidebarVisible, onViewChange, setDockerSection],
  );

  const gitSectionItems = useMemo(
    () =>
      gitSidebarTabOrder
        .filter((section): section is GitActivitySection =>
          ["changes", "history"].includes(section),
        )
        .map((section) => ({
          id: section,
          label: section === "changes" ? "Changes" : "History",
          icon: section === "changes" ? <GitDiffIcon /> : <ClockCounterClockwiseIcon />,
          active: gitSection === section,
          onClick: () => openGitSubview({ type: "show-tab", tab: section }),
        })),
    [gitSection, gitSidebarTabOrder, openGitSubview],
  );

  const githubSectionItems = useMemo(() => {
    const labels: Record<GitHubActivitySection, string> = {
      "pull-requests": "Pull Requests",
      issues: "Issues",
      actions: "Actions",
    };
    const icons: Record<GitHubActivitySection, ReactNode> = {
      "pull-requests": <GitPullRequestIcon />,
      issues: <ChatCircleTextIcon />,
      actions: <LightningIcon />,
    };

    return githubSidebarSectionOrder.map((section) => ({
      id: section,
      label: labels[section],
      icon: icons[section],
      active: githubSection === section,
      onClick: () => openGitHubSubview(section),
    }));
  }, [githubSection, githubSidebarSectionOrder, openGitHubSubview]);

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
                ...gitSectionItems,
                {
                  id: "repositories",
                  label: "Repositories",
                  icon: <FolderOpenIcon />,
                  separatorBefore: true,
                  onClick: () =>
                    openGitSubview({
                      type: "manage-branches",
                      tab: "repositories",
                    }),
                },
                {
                  id: "branches",
                  label: "Branches",
                  icon: <GitBranchIcon />,
                  onClick: () =>
                    openGitSubview({
                      type: "manage-branches",
                      tab: "branches",
                    }),
                },
                {
                  id: "worktrees",
                  label: "Worktrees",
                  icon: <NodesIcon />,
                  onClick: () =>
                    openGitSubview({
                      type: "manage-branches",
                      tab: "worktrees",
                    }),
                },
              ],
            } satisfies ActivityNavigationItem,
          ]
        : []),
      ...(coreFeatures.git
        ? [
            {
              id: "review",
              label: "Review",
              icon: <ListChecksIcon />,
              active: isPrimarySidebarItemActive && activeSidebarView === "review",
              onClick: () => onViewChange("review"),
              ariaLabel: "Review code changes",
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
              submenuItems: githubSectionItems,
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
              submenuItems: [
                {
                  id: "resources",
                  label: "Resources",
                  icon: <CubeIcon />,
                  active: dockerSection === "resources",
                  onClick: () => openDockerSubview("resources"),
                },
                {
                  id: "compose",
                  label: "Compose",
                  icon: <NodesIcon />,
                  active: dockerSection === "compose",
                  onClick: () => openDockerSubview("compose"),
                },
                {
                  id: "project",
                  label: "Project",
                  icon: <FolderOpenIcon />,
                  active: dockerSection === "project",
                  onClick: () => openDockerSubview("project"),
                },
                {
                  id: "registry",
                  label: "Registry",
                  icon: <CloudArrowDownIcon />,
                  active: dockerSection === "registry",
                  onClick: () => openDockerSubview("registry"),
                },
              ],
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
      dockerSection,
      extensionViews,
      githubSectionItems,
      gitSectionItems,
      isExtensionsActive,
      isGitHubPRsViewActive,
      isGitViewActive,
      isPrimarySidebarItemActive,
      onOpenExtensions,
      openDockerSubview,
      onViewChange,
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
