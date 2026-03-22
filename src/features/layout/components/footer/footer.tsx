import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertCircle, Download, Sparkles, Terminal as TerminalIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dropdown } from "@/ui/dropdown";
import { useAIChatStore } from "@/features/ai/store/store";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { getGitStatus } from "@/features/git/api/git-status-api";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import { useGitStore } from "@/features/git/stores/git-store";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { toast } from "@/ui/toast";
import Select from "@/ui/select";
import {
  beginDesktopAuthSession,
  DesktopAuthError,
  waitForDesktopAuthToken,
} from "@/features/window/services/auth-api";
import { buttonClassName } from "@/ui/button";
import {
  type AutocompleteModel,
  fetchAutocompleteModels,
} from "@/features/editor/services/editor-autocomplete-service";
import { cn } from "@/utils/cn";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useFileSystemStore } from "../../../file-system/controllers/store";

const footerIconButtonClass = buttonClassName({
  variant: "subtle",
  size: "xs",
  className: "rounded-md bg-primary-bg/40 px-2 text-text-lighter",
});

const footerCompactButtonClass = buttonClassName({
  variant: "subtle",
  size: "icon-sm",
  className: "rounded-md bg-primary-bg/40 text-text-lighter",
});

const DEFAULT_AUTOCOMPLETE_MODELS: AutocompleteModel[] = [
  { id: "mistralai/devstral-small", name: "Devstral Small 1.1" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
  { id: "openai/gpt-5-nano", name: "GPT-5 Nano" },
  { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
];

const AiUsageStatusIndicator = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [autocompleteModels, setAutocompleteModels] = useState<AutocompleteModel[]>(
    DEFAULT_AUTOCOMPLETE_MODELS,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);
  const handleAuthCallback = useAuthStore((state) => state.handleAuthCallback);
  const aiAutocompleteModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);
  const hasOpenRouterKey = useAIChatStore(
    (state) => state.providerApiKeys.get("openrouter") || false,
  );
  const uiState = useUIState();

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

  const loadModelOptions = async () => {
    setIsLoadingModels(true);
    try {
      const models = await fetchAutocompleteModels();
      if (models.length > 0) {
        setAutocompleteModels(models);
        if (!models.some((model) => model.id === aiAutocompleteModelId)) {
          updateSetting("aiAutocompleteModelId", models[0].id);
        }
      } else {
        setAutocompleteModels(DEFAULT_AUTOCOMPLETE_MODELS);
      }
    } catch {
      setAutocompleteModels(DEFAULT_AUTOCOMPLETE_MODELS);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([checkAllProviderApiKeys(), loadModelOptions()]);
  };

  useEffect(() => {
    void refreshAll();
  }, [checkAllProviderApiKeys]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshAll();
  }, [isOpen]);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const { sessionId, pollSecret, loginUrl } = await beginDesktopAuthSession();
      await openUrl(loginUrl);
      toast.info("Complete sign-in in your browser. Waiting for confirmation...");

      const token = await waitForDesktopAuthToken(sessionId, pollSecret);
      await handleAuthCallback(token);
      toast.success("Signed in successfully!");
      setIsOpen(false);
    } catch (error) {
      if (error instanceof DesktopAuthError && error.code === "endpoint_unavailable") {
        toast.error(
          "Desktop sign-in endpoint is unavailable on this server. Please use the local dev www server.",
        );
      } else {
        const message = error instanceof Error ? error.message : "Authentication failed.";
        toast.error(message);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          footerIconButtonClass,
          "ui-font gap-1 font-medium text-xs",
          modeToneClass,
          isOpen && "border-border/60 bg-hover/80",
        )}
        style={{ minHeight: 0, minWidth: 0 }}
        title={`${planLabel} • ${modeLabel}`}
      >
        <span className="ui-font text-[11px]">{indicatorLabel}</span>
      </button>
      <Dropdown
        isOpen={isOpen}
        anchorRef={buttonRef}
        anchorSide="top"
        anchorAlign="end"
        onClose={() => setIsOpen(false)}
        className="w-[320px] overflow-hidden rounded-xl p-0"
      >
        <div className="flex items-center justify-between border-border/70 border-b bg-secondary-bg/55 px-3 py-2.5">
          <span className="ui-font font-medium text-text text-xs">AI</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                void refreshAll();
              }}
              className={cn(footerIconButtonClass, "h-6 px-2 text-[10px]")}
            >
              Refresh
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                uiState.openSettingsDialog("ai");
              }}
              className={cn(footerIconButtonClass, "h-6 px-2 text-[10px]")}
            >
              AI Settings
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className={cn(footerCompactButtonClass, "px-0")}
              aria-label="Close AI status dropdown"
            >
              <X size={12} />
            </button>
          </div>
        </div>
        {!isAuthenticated ? (
          <div className="p-2.5">
            <button
              onClick={() => void handleSignIn()}
              disabled={isSigningIn}
              className="ui-font mt-2 flex w-full items-center justify-center rounded-lg border border-accent bg-accent p-1 text-white text-xs hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSigningIn ? "Signing in..." : "Sign in"}
            </button>
          </div>
        ) : (
          <>
            <div className="border-border/60 border-b p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-text-lighter text-xs">Plan</span>
                <span className="font-medium text-text text-xs">{planLabel}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-text-lighter text-xs">Mode</span>
                <span className={cn("font-medium text-xs", modeToneClass)}>{modeLabel}</span>
              </div>
            </div>
            <div className="p-2.5">
              <label
                htmlFor="footer-ai-model-select"
                className="mb-1 block text-text-lighter text-xs"
              >
                Model
              </label>
              <Select
                id="footer-ai-model-select"
                value={aiAutocompleteModelId}
                onChange={(value) => updateSetting("aiAutocompleteModelId", value)}
                options={autocompleteModels.map((model) => ({
                  value: model.id,
                  label: model.name,
                }))}
                disabled={isLoadingModels}
                size="sm"
                className="focus:border-accent focus:ring-accent/30"
              />
            </div>
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

  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnosticsCount = Array.from(diagnosticsByFile.values()).reduce(
    (total, diagnostics) => total + diagnostics.length,
    0,
  );

  return (
    <div className="relative z-20 flex min-h-9 shrink-0 items-center justify-between bg-secondary-bg/70 px-2.5 py-1 backdrop-blur-sm">
      <div className="ui-font flex items-center gap-1 text-text-lighter text-xs">
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
          <button
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
            className={footerCompactButtonClass}
            data-active={uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "terminal"}
            style={{ minHeight: 0, minWidth: 0 }}
            title="Toggle Terminal"
          >
            <TerminalIcon size={12} />
          </button>
        )}

        {/* Diagnostics indicator - clickable */}
        {settings.coreFeatures.diagnostics && (
          <button
            onClick={() => {
              uiState.setBottomPaneActiveTab("diagnostics");
              const showingDiagnostics =
                !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "diagnostics";
              uiState.setIsBottomPaneVisible(showingDiagnostics);
            }}
            className={cn(
              footerIconButtonClass,
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
            <AlertCircle size={12} />
            {diagnosticsCount > 0 && <span className="ml-0.5 text-[10px]">{diagnosticsCount}</span>}
          </button>
        )}
        {/* Update indicator */}
        {available && (
          <button
            onClick={downloadAndInstall}
            disabled={downloading || installing}
            className={cn(
              footerCompactButtonClass,
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
            <Download size={12} className={downloading || installing ? "animate-pulse" : ""} />
          </button>
        )}
      </div>

      <div className="ui-font flex items-center gap-1 text-text-lighter text-xs">
        {isAuthenticated && <AiUsageStatusIndicator />}

        {/* AI Chat button */}
        <button
          onClick={() => {
            useSettingsStore.getState().toggleAIChatVisible();
          }}
          className={footerCompactButtonClass}
          data-active={settings.isAIChatVisible}
          style={{ minHeight: 0, minWidth: 0 }}
          title="Toggle AI Chat"
        >
          <Sparkles size={12} />
        </button>
      </div>
    </div>
  );
};

export default Footer;
