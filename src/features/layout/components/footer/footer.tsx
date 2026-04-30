import {
  DownloadSimple,
  GearSix,
  PuzzlePiece,
  Sparkle,
  TerminalWindow,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Dropdown } from "@/ui/dropdown";
import { Tab, TabsList } from "@/ui/tabs";
import Tooltip from "@/ui/tooltip";
import { useAIChatStore } from "@/features/ai/store/store";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { getGitStatus } from "@/features/git/api/git-status-api";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import GitWorktreeSwitcher from "@/features/git/components/git-worktree-switcher";
import { useGitStore } from "@/features/git/stores/git-store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { useAuthStore } from "@/features/window/stores/auth-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { getApiBase } from "@/utils/api-base";
import { cn } from "@/utils/cn";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
import type {
  FooterLeadingItemId,
  FooterTrailingItemId,
} from "@/features/layout/config/item-order";
import { useFileSystemStore } from "../../../file-system/controllers/store";

type AutocompleteUsageSummary = {
  periodStart: string;
  periodEnd: string;
  budgetCents: number;
  reservedCents: number;
  spendCents: number;
  remainingCents: number;
  requestsCount: number;
  promptTokens: number;
  completionTokens: number;
  maxRequestCostCents: number;
};

type FooterItem<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
};

const FOOTER_ICON_TAB_CLASS_NAME = "min-w-7 px-0 [&_svg]:size-4";
const FOOTER_PILL_TAB_CLASS_NAME = "px-2.5 [&_svg]:size-4";
const FOOTER_COUNT_PILL_CLASS_NAME =
  "flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[8px] leading-3";
const FOOTER_CONTROL_GROUP_CLASS_NAME = "pointer-events-auto border-transparent bg-transparent p-0";
const FOOTER_CONTROL_CLASS_NAME =
  "rounded-md border-0 bg-transparent hover:bg-hover/60 data-[active=true]:bg-hover/70";

function orderFooterItems<T extends string>(items: Array<FooterItem<T>>, orderedIds: T[]) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const orderedItems = orderedIds
    .map((id) => itemMap.get(id))
    .filter((item): item is FooterItem<T> => Boolean(item));
  const missingItems = items.filter((item) => !orderedIds.includes(item.id));
  return [...orderedItems, ...missingItems];
}

function extractAutocompleteUsage(subscription: unknown): AutocompleteUsageSummary | null {
  if (!subscription || typeof subscription !== "object") return null;

  const container = subscription as Record<string, unknown>;
  const autocomplete =
    container.autocomplete && typeof container.autocomplete === "object"
      ? (container.autocomplete as Record<string, unknown>)
      : null;
  const usageCandidate = autocomplete?.usage;

  if (!usageCandidate || typeof usageCandidate !== "object") return null;

  const usage = usageCandidate as Record<string, unknown>;
  if (
    typeof usage.periodStart !== "string" ||
    typeof usage.periodEnd !== "string" ||
    typeof usage.budgetCents !== "number" ||
    typeof usage.spendCents !== "number"
  ) {
    return null;
  }

  return usage as unknown as AutocompleteUsageSummary;
}

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatUsageDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
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

const AiUsageStatusIndicator = () => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);
  const hasOpenRouterKey = useAIChatStore(
    (state) => state.providerApiKeys.get("openrouter") || false,
  );
  const { signIn, isSigningIn } = useDesktopSignIn({
    onSuccess: () => setIsOpen(false),
  });
  const uiState = useUIState();
  const hasBlockingModalOpen = useUIState(
    (state) =>
      state.isQuickOpenVisible ||
      state.isCommandPaletteVisible ||
      state.isGlobalSearchVisible ||
      state.isSettingsDialogVisible ||
      state.isThemeSelectorVisible ||
      state.isIconThemeSelectorVisible ||
      state.isProjectPickerVisible ||
      state.isDatabaseConnectionVisible,
  );

  const subscriptionStatus = subscription?.status ?? "free";
  const enterprisePolicy = subscription?.enterprise?.policy;
  const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
  const isPro = subscriptionStatus === "pro";
  const aiAllowedByPolicy = managedPolicy ? managedPolicy.aiCompletionEnabled : true;
  const byokAllowedByPolicy = managedPolicy ? managedPolicy.allowByok : true;
  const planLabel = (() => {
    if (!isAuthenticated) return "Guest";
    if (subscriptionStatus === "pro") return "Pro";
    return "Free";
  })();
  const usesByok = isAuthenticated && !isPro;
  const autocompleteUsage = extractAutocompleteUsage(subscription);
  const usageProgress =
    autocompleteUsage && autocompleteUsage.budgetCents > 0
      ? Math.min(
          100,
          Math.max(0, (autocompleteUsage.spendCents / autocompleteUsage.budgetCents) * 100),
        )
      : 0;

  const modeLabel = (() => {
    if (!isAuthenticated) return "Guest";
    if (!aiAllowedByPolicy) return "Blocked";
    if (isPro) return "Hosted";
    if (!byokAllowedByPolicy) return "Blocked";
    return hasOpenRouterKey ? "BYOK" : "Key required";
  })();

  const indicatorLabel = !isAuthenticated ? "Guest" : planLabel;

  const modeToneClass = (() => {
    if (!isAuthenticated || !aiAllowedByPolicy) return "text-error";
    if (usesByok && !hasOpenRouterKey) return "text-warning";
    if (usesByok) return "text-accent";
    return "text-accent";
  })();

  const refreshAll = async () => {
    await checkAllProviderApiKeys();
  };

  const openBillingDashboard = async () => {
    const apiBase = getApiBase();
    const billingUrl = new URL("/dashboard/billing", apiBase).toString();
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(billingUrl);
  };

  useEffect(() => {
    void refreshAll();
  }, [checkAllProviderApiKeys]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshAll();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !hasBlockingModalOpen) return;
    setIsOpen(false);
  }, [hasBlockingModalOpen, isOpen]);

  const handleSignIn = async () => {
    await signIn();
  };

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        type="button"
        onClick={() => {
          const nextOpen = !isOpen;
          setIsOpen(nextOpen);
          if (nextOpen) {
            void refreshAll();
          }
        }}
        variant="secondary"
        size="xs"
        className={cn(
          "rounded-md border-transparent bg-transparent px-2 text-text-lighter hover:bg-hover/60",
          "ui-font ui-text-sm gap-1 font-medium",
          modeToneClass,
          isOpen && "bg-hover/70",
        )}
        style={{ minHeight: 0, minWidth: 0 }}
        tooltip={`${planLabel} • ${modeLabel}`}
      >
        <span className="ui-font ui-text-sm">{indicatorLabel}</span>
      </Button>
      <Dropdown
        isOpen={isOpen}
        anchorRef={buttonRef}
        anchorSide="top"
        anchorAlign="end"
        onClose={() => setIsOpen(false)}
        className="w-[320px] overflow-hidden rounded-xl p-0"
      >
        <div className="flex items-center justify-between border-border/70 border-b bg-secondary-bg/55 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="ui-font ui-text-md font-medium text-text">AI</span>
            {isPro ? (
              <Badge
                variant="default"
                shape="pill"
                size="compact"
                className="border-accent/30 bg-accent/10 text-accent"
              >
                Pro
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              onClick={() => {
                setIsOpen(false);
                uiState.openSettingsDialog("ai");
              }}
              variant="secondary"
              size="icon-sm"
              className="px-0 text-text-lighter"
              tooltip="AI Settings"
              aria-label="Open AI settings"
            >
              <GearSix weight="duotone" />
            </Button>
            <Button
              onClick={() => setIsOpen(false)}
              variant="secondary"
              size="icon-sm"
              className="px-0 text-text-lighter"
              aria-label="Close AI status dropdown"
            >
              <X weight="bold" />
            </Button>
          </div>
        </div>
        {!isAuthenticated ? (
          <div className="p-2.5">
            <Button
              onClick={() => void handleSignIn()}
              disabled={isSigningIn}
              variant="primary"
              size="sm"
              className="mt-2 w-full justify-center rounded-lg text-white hover:opacity-90"
            >
              {isSigningIn ? "Signing in..." : "Sign in"}
            </Button>
          </div>
        ) : (
          <>
            <Button
              type="button"
              onClick={() => void openBillingDashboard()}
              variant="ghost"
              className="ui-font block h-auto w-full justify-start border-border/60 border-b rounded-none p-2.5 text-left transition-colors hover:bg-hover/40"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="ui-text-sm text-text-lighter">Usage</span>
                <span className="ui-text-xs text-text-lighter/70">Current period</span>
              </div>
              {autocompleteUsage ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="ui-text-sm text-text-lighter">Hosted autocomplete</span>
                    <span className="ui-text-sm font-medium text-text">
                      {formatUsdFromCents(autocompleteUsage.spendCents)} /{" "}
                      {formatUsdFromCents(autocompleteUsage.budgetCents)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-primary-bg/80">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-200"
                      style={{ width: `${usageProgress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="ui-text-xs text-text-lighter/70">
                      {formatUsageDate(autocompleteUsage.periodStart)} -{" "}
                      {formatUsageDate(autocompleteUsage.periodEnd)}
                    </span>
                    <span className="ui-text-xs text-text-lighter/70">
                      Resets {formatUsageDate(autocompleteUsage.periodEnd)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="ui-text-sm text-text-lighter/80">Usage unavailable</div>
              )}
            </Button>
          </>
        )}
      </Dropdown>
    </div>
  );
};

const Footer = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
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
  const { available, downloading, installing, updateInfo, downloadAndInstall } = useUpdater(false);

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
    available
      ? {
          id: "updates",
          label: "App updates",
          content: (
            <FooterTabControl
              tooltip={
                downloading
                  ? "Downloading update..."
                  : installing
                    ? "Installing update..."
                    : `Update available: ${updateInfo?.version}`
              }
              className={cn(
                FOOTER_ICON_TAB_CLASS_NAME,
                downloading || installing
                  ? "cursor-not-allowed opacity-60"
                  : "text-blue-400 hover:text-blue-300",
              )}
              onClick={() => {
                if (!downloading && !installing) {
                  void downloadAndInstall();
                }
              }}
            >
              <DownloadSimple
                className={cn(downloading || (installing && "animate-pulse"))}
                weight="duotone"
              />
            </FooterTabControl>
          ),
        }
      : null,
  ];
  const footerLeadingItems = footerLeadingItemsSource.filter(
    (item): item is FooterItem<FooterLeadingItemId> => item !== null,
  );

  const footerTrailingItemsSource: Array<FooterItem<FooterTrailingItemId> | null> = [
    isAuthenticated
      ? {
          id: "ai-usage",
          label: "AI usage",
          content: <AiUsageStatusIndicator />,
        }
      : null,
    {
      id: "ai-chat",
      label: "AI chat",
      content: (
        <FooterTabControl
          tooltip="Toggle AI Chat"
          active={settings.isAIChatVisible}
          className={FOOTER_ICON_TAB_CLASS_NAME}
          commandId="workbench.toggleAIChat"
          onClick={() => {
            useSettingsStore.getState().toggleAIChatVisible();
          }}
        >
          <Sparkle weight="duotone" />
        </FooterTabControl>
      ),
    },
  ];
  const footerTrailingItems = footerTrailingItemsSource.filter(
    (item): item is FooterItem<FooterTrailingItemId> => item !== null,
  );

  return (
    <div className="relative z-20 flex min-h-9 shrink-0 items-center justify-between bg-secondary-bg/70 px-2.5 py-1 backdrop-blur-sm">
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
