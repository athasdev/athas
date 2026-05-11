import {
  BugBeetle,
  CaretUp,
  Database,
  DownloadSimple,
  ListBullets,
  Network,
  PuzzlePiece,
  TerminalWindow,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { cva } from "class-variance-authority";
import { type ReactNode, type Ref, useMemo, useRef, useState } from "react";
import { Tab, TabsList } from "@/ui/tabs";
import { LoadingIndicator } from "@/ui/loading";
import Tooltip from "@/ui/tooltip";
import { Dropdown } from "@/ui/dropdown";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import {
  chromeControl,
  chromeControlGroup,
  chromeIcon,
  chromeItemWrapper,
} from "@/features/layout/components/chrome-control-styles";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { getGitStatus } from "@/features/git/api/git-status-api";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import GitWorktreeSwitcher from "@/features/git/components/git-worktree-switcher";
import { useGitStore } from "@/features/git/stores/git-store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { useAutoUpdate } from "@/features/settings/hooks/use-auto-update";
import { useSettingsStore } from "@/features/settings/store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { cn } from "@/utils/cn";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { NotificationsTrigger } from "@/features/window/components/notifications-sidebar";
import {
  FOOTER_TRAILING_ITEM_IDS,
  normalizeItemOrder,
  type FooterLeadingItemId,
  type FooterTrailingItemId,
} from "@/features/layout/config/item-order";
import { useFileSystemStore } from "../../../file-system/controllers/store";

type FooterItem<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
};

const footerCountPill = cva(
  "flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 ui-text-xs leading-3",
);
const footerGitTrigger = cva("h-6 w-fit rounded-md");
const footerGitTriggerInput = cva("ui-text-sm");

function orderFooterItems<T extends string>(items: Array<FooterItem<T>>, orderedIds: T[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is FooterItem<T> => Boolean(item));
  const missingItems = items.filter((item) => !orderedIds.includes(item.id));
  return [...orderedItems, ...missingItems];
}

function FooterTabControl({
  tooltip,
  active = false,
  className,
  onClick,
  commandId,
  controlRef,
  children,
}: {
  tooltip: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
  commandId?: string;
  controlRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const shortcut = useCommandShortcut(commandId);

  return (
    <TabsList variant="segmented" className={chromeControlGroup()}>
      <Tooltip content={tooltip} shortcut={shortcut} side="top">
        <Tab
          ref={controlRef}
          role="button"
          aria-label={tooltip}
          tabIndex={0}
          isActive={active}
          size="xs"
          variant="segmented"
          className={className}
          onClick={onClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onClick();
            }
          }}
        >
          {children}
        </Tab>
      </Tooltip>
    </TabsList>
  );
}

const Footer = () => {
  const settings = useSettingsStore((state) => state.settings);
  const uiState = useUIState();
  const hasTeamsCollaborationAccess = useAuthStore(
    (state) => state.subscription?.collaboration?.enabled === true,
  );
  const isCollaborationFeatureEnabled =
    hasTeamsCollaborationAccess && settings.coreFeatures.teamCollaboration;
  const isMultiAgentsFeatureEnabled =
    settings.coreFeatures.aiChat && settings.coreFeatures.multiAgents;
  const { openSidebarView } = useSidebarPaneController();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const buffers = useBufferStore.use.buffers();
  const openDiagnosticsBuffer = useBufferStore.use.actions().openDiagnosticsBuffer;
  const { rootFolderPath } = useFileSystemStore();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const selectRepository = useRepositoryStore.use.actions().selectRepository;
  const gitStatus = useGitStore((state) => state.gitStatus);
  const workspaceGitStatus = useGitStore((state) => state.workspaceGitStatus);
  const currentRepoPath = useGitStore((state) => state.currentRepoPath);
  const currentWorkspaceRepoPath = useGitStore((state) => state.currentWorkspaceRepoPath);
  const { actions } = useGitStore();
  const {
    showUpdateIndicator,
    downloading,
    installing,
    error: updateError,
    updateInfo,
    downloadProgress,
    onDownload: downloadAndInstall,
    onDismiss: dismissUpdate,
    onRemindLater,
    onSkipVersion,
    onViewReleaseNotes,
  } = useAutoUpdate();
  const [isUpdateMenuOpen, setIsUpdateMenuOpen] = useState(false);
  const updateMenuRef = useRef<HTMLDivElement>(null);

  const extensionUpdatesCount = useExtensionStore.use.extensionsWithUpdates().size;
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnosticsCount = Array.from(diagnosticsByFile.values()).reduce(
    (total, diagnostics) => total + diagnostics.length,
    0,
  );
  const isDiagnosticsBufferActive = buffers.some(
    (buffer) => buffer.id === activeBufferId && buffer.type === "diagnostics",
  );
  const footerRepoPath = activeRepoPath ?? currentWorkspaceRepoPath ?? rootFolderPath;
  const footerGitStatus =
    activeRepoPath && currentRepoPath === activeRepoPath && gitStatus
      ? gitStatus
      : workspaceGitStatus;
  const footerBranch = footerGitStatus?.branch;
  const updateMenuItems = useMemo(
    () => [
      {
        id: "release-notes",
        label: "View Release Notes",
        onClick: onViewReleaseNotes,
        disabled: downloading || installing,
      },
      {
        id: "download-later",
        label: "Download Later",
        onClick: dismissUpdate,
        disabled: downloading || installing,
      },
      {
        id: "remind-later",
        label: "Remind Me Tomorrow",
        onClick: onRemindLater,
        disabled: downloading || installing,
      },
      {
        id: "skip-version",
        label: `Skip ${updateInfo?.version ?? "Version"}`,
        onClick: onSkipVersion,
        disabled: downloading || installing,
      },
    ],
    [
      dismissUpdate,
      downloading,
      installing,
      onRemindLater,
      onSkipVersion,
      onViewReleaseNotes,
      updateInfo?.version,
    ],
  );

  const footerLeadingItemsSource: Array<FooterItem<FooterLeadingItemId> | null> = [
    footerRepoPath && footerBranch
      ? {
          id: "branch",
          label: "Git branch",
          content: (
            <div className="flex shrink-0 items-center gap-1">
              <GitBranchManager
                currentBranch={footerBranch}
                repoPath={footerRepoPath}
                paletteTarget
                placement="down"
                triggerIconSize={16}
                triggerClassName={footerGitTrigger()}
                triggerInputClassName={cn(footerGitTriggerInput(), "max-w-[220px]")}
                onBranchChange={async () => {
                  const status = await getGitStatus(footerRepoPath);
                  actions.setWorkspaceGitStatus(status, footerRepoPath);
                  if (currentRepoPath === footerRepoPath) {
                    actions.setGitStatus(status);
                  }
                }}
              />
              <GitWorktreeSwitcher
                repoPath={footerRepoPath}
                placement="down"
                triggerIconSize={16}
                triggerClassName={footerGitTrigger()}
                triggerInputClassName={cn(footerGitTriggerInput(), "max-w-[118px]")}
                onWorktreeChange={async (worktreePath) => {
                  selectRepository(worktreePath);
                  const status = await getGitStatus(worktreePath);
                  actions.setWorkspaceGitStatus(status, worktreePath);
                  if (currentRepoPath === footerRepoPath) {
                    actions.setGitStatus(status);
                  }
                }}
              />
            </div>
          ),
        }
      : null,
    settings.coreFeatures.terminal
      ? {
          id: "terminal",
          label: "Terminal",
          content: (
            <FooterTabControl
              tooltip="Toggle Terminal"
              active={uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "terminal"}
              className={chromeControl()}
              commandId="workbench.toggleTerminal"
              onClick={() => {
                uiState.setBottomPaneActiveTab("terminal");
                const showingTerminal =
                  !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "terminal";
                uiState.setIsBottomPaneVisible(showingTerminal);

                if (showingTerminal) {
                  setTimeout(() => {
                    uiState.requestTerminalFocus();
                  }, 100);
                }
              }}
            >
              <TerminalWindow weight="duotone" />
            </FooterTabControl>
          ),
        }
      : null,
    settings.coreFeatures.debugger
      ? {
          id: "debugger",
          label: "Run and Debug",
          content: (
            <FooterTabControl
              tooltip="Toggle Run and Debug"
              active={uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "debugger"}
              className={chromeControl()}
              commandId="workbench.showDebugger"
              onClick={() => {
                uiState.setBottomPaneActiveTab("debugger");
                const showingDebugger =
                  !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "debugger";
                uiState.setIsBottomPaneVisible(showingDebugger);
              }}
            >
              <BugBeetle weight="duotone" />
            </FooterTabControl>
          ),
        }
      : null,
    settings.coreFeatures.diagnostics
      ? {
          id: "diagnostics",
          label: "Diagnostics",
          content: (
            <FooterTabControl
              tooltip={
                diagnosticsCount > 0
                  ? `${diagnosticsCount} diagnostic${diagnosticsCount === 1 ? "" : "s"}`
                  : "Open Diagnostics"
              }
              active={isDiagnosticsBufferActive}
              className={cn(
                chromeControl({ shape: "pill" }),
                !isDiagnosticsBufferActive && diagnosticsCount > 0 && "text-warning",
              )}
              commandId="workbench.toggleDiagnostics"
              onClick={() => openDiagnosticsBuffer()}
            >
              <WarningCircle weight="duotone" />
              {diagnosticsCount > 0 && (
                <span className="ui-font ui-text-sm font-medium tabular-nums text-current">
                  {diagnosticsCount}
                </span>
              )}
            </FooterTabControl>
          ),
        }
      : null,
    extensionUpdatesCount > 0
      ? {
          id: "extensions",
          label: "Extension updates",
          content: (
            <FooterTabControl
              tooltip={`${extensionUpdatesCount} extension update${extensionUpdatesCount === 1 ? "" : "s"} available`}
              className={cn(chromeControl({ shape: "pill" }), "text-blue-400 hover:text-blue-300")}
              onClick={() => uiState.openSettingsDialog("extensions")}
            >
              <PuzzlePiece weight="duotone" />
              <span className={cn(footerCountPill(), "bg-blue-400 text-primary-bg")}>
                {extensionUpdatesCount > 9 ? "9+" : extensionUpdatesCount}
              </span>
            </FooterTabControl>
          ),
        }
      : null,
    showUpdateIndicator && updateInfo
      ? {
          id: "updates",
          label: "App updates",
          content: (
            <div className="flex items-center gap-0.5">
              <FooterTabControl
                tooltip={
                  updateError
                    ? updateError
                    : downloading
                      ? `Updating Athas ${downloadProgress?.percentage ?? 0}%`
                      : installing
                        ? "Installing update..."
                        : `Update available: ${updateInfo.version}`
                }
                className={cn(
                  chromeControl({ shape: "pill" }),
                  downloading || installing
                    ? "cursor-wait bg-accent/15 text-accent hover:bg-accent/20 hover:text-accent"
                    : updateError
                      ? "text-error hover:bg-error/10 hover:text-error"
                      : "text-accent hover:bg-accent/10 hover:text-accent",
                )}
                onClick={() => {
                  if (!downloading && !installing) {
                    void downloadAndInstall();
                  }
                }}
              >
                {downloading || installing ? (
                  <LoadingIndicator label={downloading ? "Downloading" : "Installing"} compact />
                ) : (
                  <DownloadSimple weight="duotone" />
                )}
                <span className="ui-font ui-text-xs font-medium">
                  {downloading
                    ? `Updating ${downloadProgress?.percentage ?? 0}%`
                    : installing
                      ? "Installing"
                      : updateError
                        ? "Update failed"
                        : "Update available"}
                </span>
              </FooterTabControl>
              <FooterTabControl
                tooltip="Update Options"
                active={isUpdateMenuOpen}
                className={cn(
                  chromeControl(),
                  updateError
                    ? "text-error hover:bg-error/10 hover:text-error"
                    : "text-accent hover:bg-accent/10 hover:text-accent",
                )}
                controlRef={updateMenuRef}
                onClick={() => setIsUpdateMenuOpen((open) => !open)}
              >
                <CaretUp weight="bold" />
              </FooterTabControl>
              <Dropdown
                isOpen={isUpdateMenuOpen}
                onClose={() => setIsUpdateMenuOpen(false)}
                anchorRef={updateMenuRef}
                anchorSide="top"
                anchorAlign="start"
                items={updateMenuItems}
                className="min-w-[210px]"
              />
            </div>
          ),
        }
      : null,
  ];
  const footerLeadingItems = footerLeadingItemsSource.filter(
    (item): item is FooterItem<FooterLeadingItemId> => item !== null,
  );
  const shouldShowOutline = settings.coreFeatures.outline;
  const isOutlineActive =
    uiState.isRightSidebarVisible && uiState.activeRightSidebarView === "outline";
  const isDatabasesActive =
    uiState.isRightSidebarVisible && uiState.activeRightSidebarView === "databases";
  const isCollaborationActive =
    uiState.isRightSidebarVisible && uiState.activeRightSidebarView === "collaboration";
  const isMultiAgentsActive =
    uiState.isRightSidebarVisible && uiState.activeRightSidebarView === "multi-agents";
  const footerTrailingOrder = useMemo<FooterTrailingItemId[]>(() => {
    const normalizedOrder = normalizeItemOrder(
      settings.footerTrailingItemsOrder,
      FOOTER_TRAILING_ITEM_IDS,
    ) as FooterTrailingItemId[];

    if (!normalizedOrder.includes("multi-agents")) return normalizedOrder;

    return ["multi-agents", ...normalizedOrder.filter((itemId) => itemId !== "multi-agents")];
  }, [settings.footerTrailingItemsOrder]);

  const footerTrailingItems: Array<FooterItem<FooterTrailingItemId>> = [
    ...(isMultiAgentsFeatureEnabled
      ? [
          {
            id: "multi-agents" as const,
            label: "Multi Agents",
            content: (
              <FooterTabControl
                tooltip="Multi Agents"
                active={isMultiAgentsActive}
                className={chromeControl()}
                onClick={() => {
                  openSidebarView("multi-agents", { paneLevel: "edge", triggerSide: "right" });
                }}
              >
                <Network className={chromeIcon()} weight="duotone" />
              </FooterTabControl>
            ),
          },
        ]
      : []),
    ...(shouldShowOutline
      ? [
          {
            id: "outline" as const,
            label: "Outline",
            content: (
              <FooterTabControl
                tooltip="Outline"
                active={isOutlineActive}
                className={chromeControl()}
                commandId="workbench.focusOutline"
                onClick={() => {
                  openSidebarView("outline", { triggerSide: "right" });
                }}
              >
                <ListBullets className={chromeIcon()} weight="duotone" />
              </FooterTabControl>
            ),
          },
        ]
      : []),
    {
      id: "databases",
      label: "Databases",
      content: (
        <FooterTabControl
          tooltip="Databases"
          active={isDatabasesActive}
          className={chromeControl()}
          commandId="database.connect"
          onClick={() => {
            openSidebarView("databases", { triggerSide: "right" });
          }}
        >
          <Database className={chromeIcon()} weight="duotone" />
        </FooterTabControl>
      ),
    },
    ...(isCollaborationFeatureEnabled
      ? [
          {
            id: "collaboration" as const,
            label: "Collaboration",
            content: (
              <FooterTabControl
                tooltip="Collaboration"
                active={isCollaborationActive}
                className={chromeControl()}
                onClick={() => {
                  openSidebarView("collaboration", { triggerSide: "right" });
                }}
              >
                <UsersThree className={chromeIcon()} weight="duotone" />
              </FooterTabControl>
            ),
          },
        ]
      : []),
    {
      id: "notifications",
      label: "Notifications",
      content: <NotificationsTrigger />,
    },
  ];

  return (
    <div className="athas-footer-bar relative z-20 flex h-8 shrink-0 items-center justify-between bg-secondary-bg/70 px-2.5 py-1 backdrop-blur-sm">
      <div className="ui-font ui-text-sm flex items-center gap-1 text-text-lighter">
        {orderFooterItems(footerLeadingItems, settings.footerLeadingItemsOrder).map((item) => (
          <div key={item.id} className={chromeItemWrapper()}>
            {item.content}
          </div>
        ))}
      </div>

      <div className="ui-font ui-text-sm flex items-center gap-1 text-text-lighter">
        {orderFooterItems(footerTrailingItems, footerTrailingOrder).map((item) => (
          <div key={item.id} className={chromeItemWrapper()}>
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Footer;
