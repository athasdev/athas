import {
  AlertCircle,
  Download,
  Puzzle,
  Settings2,
  Sparkles,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dropdown } from "@/ui/dropdown";
import { useAIChatStore } from "@/features/ai/store/store";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { getGitStatus } from "@/features/git/api/git-status-api";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import { useGitStore } from "@/features/git/stores/git-store";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { getApiBase } from "@/utils/api-base";
import { cn } from "@/utils/cn";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useDesktopSignIn } from "@/features/window/hooks/use-desktop-sign-in";
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
    if (!isAuthenticated || !aiAllowedByPolicy) return "text-red-400";
    if (usesByok && !hasOpenRouterKey) return "text-yellow-400";
    if (usesByok) return "text-blue-400";
    return "text-emerald-400";
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
          "rounded-md bg-primary-bg/40 px-2 text-text-lighter",
          "ui-font ui-text-sm gap-1 font-medium",
          modeToneClass,
          isOpen && "border-border/60 bg-hover/80",
        )}
        style={{ minHeight: 0, minWidth: 0 }}
        title={`${planLabel} • ${modeLabel}`}
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
              <Badge variant="accent" shape="pill" size="compact" className="text-emerald-300">
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
              aria-label="Open AI settings"
              title="AI Settings"
            >
              <Settings2 />
            </Button>
            <Button
              onClick={() => setIsOpen(false)}
              variant="secondary"
              size="icon-sm"
              className="px-0 text-text-lighter"
              aria-label="Close AI status dropdown"
            >
              <X />
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
            <button
              type="button"
              onClick={() => void openBillingDashboard()}
              className="border-border/60 block w-full border-b p-2.5 text-left transition-colors hover:bg-hover/40"
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
                      className="h-full rounded-full bg-emerald-400/90 transition-[width] duration-200"
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
            </button>
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
  const { rootFolderPath } = useFileSystemStore();
  const workspaceGitStatus = useGitStore((state) => state.workspaceGitStatus);
  const { actions } = useGitStore();
  const { available, downloading, installing, updateInfo, downloadAndInstall } = useUpdater(false);

  const extensionUpdatesCount = useExtensionStore.use.extensionsWithUpdates().size;
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnosticsCount = Array.from(diagnosticsByFile.values()).reduce(
    (total, diagnostics) => total + diagnostics.length,
    0,
  );

  return (
    <div className="relative z-20 flex min-h-9 shrink-0 items-center justify-between bg-secondary-bg/70 px-2.5 py-1 backdrop-blur-sm">
      <div className="ui-font ui-text-sm flex items-center gap-1 text-text-lighter">
        {/* Git branch manager */}
        {rootFolderPath && workspaceGitStatus?.branch && (
          <GitBranchManager
            currentBranch={workspaceGitStatus.branch}
            repoPath={rootFolderPath}
            paletteTarget
            placement="up"
            onBranchChange={async () => {
              const status = await getGitStatus(rootFolderPath);
              actions.setWorkspaceGitStatus(status, rootFolderPath);
            }}
            compact={true}
          />
        )}

        {/* Terminal indicator */}
        {settings.coreFeatures.terminal && (
          <Button
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
            variant="secondary"
            size="icon-sm"
            className="rounded-md bg-primary-bg/40 text-text-lighter"
            data-active={uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "terminal"}
            style={{ minHeight: 0, minWidth: 0 }}
            title="Toggle Terminal"
          >
            <TerminalIcon />
          </Button>
        )}

        {/* Diagnostics indicator - clickable */}
        {settings.coreFeatures.diagnostics && (
          <Button
            onClick={() => {
              uiState.setBottomPaneActiveTab("diagnostics");
              const showingDiagnostics =
                !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "diagnostics";
              uiState.setIsBottomPaneVisible(showingDiagnostics);
            }}
            variant="secondary"
            size="xs"
            className={cn(
              "rounded-md bg-primary-bg/40 px-2 text-text-lighter",
              !(uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "diagnostics") &&
                diagnosticsCount > 0 &&
                "text-warning",
            )}
            data-active={
              uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "diagnostics"
            }
            style={{ minHeight: 0, minWidth: 0 }}
            title={
              diagnosticsCount > 0
                ? `${diagnosticsCount} diagnostic${diagnosticsCount === 1 ? "" : "s"}`
                : "Toggle Diagnostics Panel"
            }
          >
            <AlertCircle />
            {diagnosticsCount > 0 && <span className="ui-text-sm ml-0.5">{diagnosticsCount}</span>}
          </Button>
        )}
        {/* Extension updates indicator */}
        {extensionUpdatesCount > 0 && (
          <Button
            onClick={() => uiState.openSettingsDialog("extensions")}
            variant="secondary"
            size="xs"
            className="rounded-md bg-primary-bg/40 px-2 text-blue-400"
            style={{ minHeight: 0, minWidth: 0 }}
            title={`${extensionUpdatesCount} extension update${extensionUpdatesCount === 1 ? "" : "s"} available`}
          >
            <Puzzle />
            <span className="ui-text-sm ml-0.5">{extensionUpdatesCount}</span>
          </Button>
        )}
        {/* Update indicator */}
        {available && (
          <Button
            onClick={downloadAndInstall}
            disabled={downloading || installing}
            variant="secondary"
            size="icon-sm"
            className={cn(
              "rounded-md bg-primary-bg/40 text-text-lighter",
              downloading || installing
                ? "cursor-not-allowed opacity-60"
                : "text-blue-400 hover:text-blue-300",
            )}
            style={{ minHeight: 0, minWidth: 0 }}
            title={
              downloading
                ? "Downloading update..."
                : installing
                  ? "Installing update..."
                  : `Update available: ${updateInfo?.version}`
            }
          >
            <Download className={downloading || installing ? "animate-pulse" : ""} />
          </Button>
        )}
      </div>

      <div className="ui-font ui-text-sm flex items-center gap-1 text-text-lighter">
        {isAuthenticated && <AiUsageStatusIndicator />}

        {/* AI Chat button */}
        <Button
          onClick={() => {
            useSettingsStore.getState().toggleAIChatVisible();
          }}
          variant="secondary"
          size="icon-sm"
          className="rounded-md bg-primary-bg/40 text-text-lighter"
          data-active={settings.isAIChatVisible}
          style={{ minHeight: 0, minWidth: 0 }}
          title="Toggle AI Chat"
        >
          <Sparkles />
        </Button>
      </div>
    </div>
  );
};

export default Footer;
