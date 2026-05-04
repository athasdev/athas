import {
  ArrowClockwise,
  DownloadSimple,
  PuzzlePiece,
  TerminalWindow,
  WarningCircle,
} from "@phosphor-icons/react";
import { type ReactNode } from "react";
import { Tab, TabsList } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
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
import type {
  FooterLeadingItemId,
  FooterTrailingItemId,
} from "@/features/layout/config/item-order";
import { useFileSystemStore } from "../../../file-system/controllers/store";

type FooterItem<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
};

const FOOTER_ICON_TAB_CLASS_NAME = "h-6 w-7 min-w-7 px-0 [&_svg]:size-4";
const FOOTER_PILL_TAB_CLASS_NAME = "h-6 px-2 [&_svg]:size-4";
const FOOTER_COUNT_PILL_CLASS_NAME =
  "flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[8px] leading-3";
const FOOTER_CONTROL_GROUP_CLASS_NAME = "pointer-events-auto border-transparent bg-transparent p-0";
const FOOTER_CONTROL_CLASS_NAME =
  "rounded-md border-0 bg-transparent hover:bg-hover/60 data-[active=true]:bg-hover/70";
const FOOTER_GIT_TRIGGER_CLASS_NAME = "h-6 w-fit rounded-md";
const FOOTER_GIT_TRIGGER_INPUT_CLASS_NAME = "pl-7 ui-text-sm";

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
  children,
}: {
  tooltip: string;
  active?: boolean;
  className?: string;
  onClick: () => void;
  commandId?: string;
  children: ReactNode;
}) {
  const shortcut = useCommandShortcut(commandId);

  return (
    <TabsList variant="segmented" className={FOOTER_CONTROL_GROUP_CLASS_NAME}>
      <Tooltip content={tooltip} shortcut={shortcut} side="top">
        <Tab
          role="button"
          aria-label={tooltip}
          tabIndex={0}
          isActive={active}
          size="xs"
          variant="segmented"
          className={cn(FOOTER_CONTROL_CLASS_NAME, className)}
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
  } = useAutoUpdate();

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
                placement="up"
                triggerIconSize={16}
                triggerClassName={FOOTER_GIT_TRIGGER_CLASS_NAME}
                triggerInputClassName={cn(FOOTER_GIT_TRIGGER_INPUT_CLASS_NAME, "max-w-[220px]")}
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
                placement="up"
                triggerIconSize={16}
                triggerClassName={FOOTER_GIT_TRIGGER_CLASS_NAME}
                triggerInputClassName={cn(FOOTER_GIT_TRIGGER_INPUT_CLASS_NAME, "max-w-[118px]")}
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
              className={FOOTER_ICON_TAB_CLASS_NAME}
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
                FOOTER_PILL_TAB_CLASS_NAME,
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
              className={cn(FOOTER_PILL_TAB_CLASS_NAME, "text-blue-400 hover:text-blue-300")}
              onClick={() => uiState.openSettingsDialog("extensions")}
            >
              <PuzzlePiece weight="duotone" />
              <span className={cn(FOOTER_COUNT_PILL_CLASS_NAME, "bg-blue-400 text-primary-bg")}>
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
                FOOTER_PILL_TAB_CLASS_NAME,
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
                <ArrowClockwise className="animate-spin" weight="duotone" />
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
          ),
        }
      : null,
  ];
  const footerLeadingItems = footerLeadingItemsSource.filter(
    (item): item is FooterItem<FooterLeadingItemId> => item !== null,
  );

  const footerTrailingItems: Array<FooterItem<FooterTrailingItemId>> = [];

  return (
    <div className="relative z-20 flex h-8 shrink-0 items-center justify-between bg-secondary-bg/70 px-2.5 py-1 backdrop-blur-sm">
      <div className="ui-font ui-text-sm flex items-center gap-1 text-text-lighter">
        {orderFooterItems(footerLeadingItems, settings.footerLeadingItemsOrder).map((item) => (
          <div key={item.id}>{item.content}</div>
        ))}
      </div>

      <div className="ui-font ui-text-sm flex items-center gap-1 text-text-lighter">
        {orderFooterItems(footerTrailingItems, settings.footerTrailingItemsOrder).map((item) => (
          <div key={item.id}>{item.content}</div>
        ))}
      </div>
    </div>
  );
};

export default Footer;
