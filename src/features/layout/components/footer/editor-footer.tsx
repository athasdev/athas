import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Download,
  Loader2,
  Settings,
  Sparkles,
  Terminal as TerminalIcon,
  X,
  Zap,
  ZapOff,
} from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnClickOutside } from "usehooks-ts";
import { useAIChatStore } from "@/features/ai/store/store";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { type LspStatus, useLspStore } from "@/features/editor/lsp/lsp-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { getGitStatus } from "@/features/git/api/status";
import GitBranchManager from "@/features/git/components/branch-manager";
import { useGitStore } from "@/features/git/stores/git-store";
import { useUpdater } from "@/features/settings/hooks/use-updater";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/stores/toast-store";
import {
  beginDesktopAuthSession,
  DesktopAuthError,
  waitForDesktopAuthToken,
} from "@/utils/auth-api";
import { type AutocompleteModel, fetchAutocompleteModels } from "@/utils/autocomplete";
import { cn } from "@/utils/cn";
import { useUIState } from "../../../../stores/ui-state-store";
import { getFilenameFromPath } from "../../../file-system/controllers/file-utils";
import { useFileSystemStore } from "../../../file-system/controllers/store";
import VimStatusIndicator from "../../../vim/components/vim-status-indicator";

const DEFAULT_AUTOCOMPLETE_MODELS: AutocompleteModel[] = [
  { id: "openai/gpt-5-nano", name: "GPT-5 Nano" },
  { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
  { id: "openai/gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
  { id: "google/gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
];

// LSP Status Indicator Component
const LspStatusIndicator = ({ projectName }: { projectName: string | null }) => {
  const lspStatus = useLspStore.use.lspStatus();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useOnClickOutside(dropdownRef as RefObject<HTMLElement>, (event) => {
    const target = event.target as HTMLElement;
    if (target && buttonRef.current?.contains(target)) {
      return;
    }
    setIsOpen(false);
  });

  // Update position when opened
  useLayoutEffect(() => {
    if (isOpen && buttonRef.current && dropdownRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const dropdownWidth = dropdownRect.width;
      const dropdownHeight = dropdownRect.height;
      const padding = 8;

      // Calculate position - open above and to the left
      let left = rect.right - dropdownWidth;
      let top = rect.top - dropdownHeight - padding;

      // Ensure it doesn't go off the left edge
      if (left < padding) {
        left = padding;
      }

      // Ensure it doesn't go off the right edge
      if (left + dropdownWidth > window.innerWidth - padding) {
        left = window.innerWidth - dropdownWidth - padding;
      }

      // Ensure it doesn't go off the top edge
      if (top < padding) {
        top = rect.bottom + padding;
      }

      setPosition({ top, left });
    }
  }, [isOpen]);

  const getStatusConfig = (status: LspStatus) => {
    switch (status) {
      case "connected":
        return {
          icon: <Zap size={12} />,
          color: "text-green-400",
          bgHover: "hover:bg-green-400/10",
          title: "Language Servers Active",
        };
      case "connecting":
        return {
          icon: <Loader2 size={12} className="animate-spin" />,
          color: "text-yellow-400",
          bgHover: "hover:bg-yellow-400/10",
          title: "Connecting to Language Server...",
        };
      case "error":
        return {
          icon: <ZapOff size={12} />,
          color: "text-red-400",
          bgHover: "hover:bg-red-400/10",
          title: `Language Server Error: ${lspStatus.lastError || "Unknown"}`,
        };
      default:
        return {
          icon: <ZapOff size={12} />,
          color: "text-text-lighter opacity-50",
          bgHover: "hover:bg-hover",
          title: "No active language servers",
        };
    }
  };

  const config = getStatusConfig(lspStatus.status);

  // Get active language servers from supported languages or workspaces
  const activeServers = lspStatus.supportedLanguages || [];
  const hasActiveServers = lspStatus.status === "connected" && activeServers.length > 0;

  const renderDropdown = () => {
    if (!isOpen) return null;

    return (
      <div
        ref={dropdownRef}
        className="fixed z-9999 w-[260px] overflow-hidden rounded-lg border border-border bg-secondary-bg shadow-xl"
        style={{ top: position.top, left: position.left }}
      >
        {/* Header - Project Name */}
        <div className="border-border border-b bg-primary-bg/50 px-3 py-2">
          <span className="font-medium text-text text-xs">{projectName || "No Project"}</span>
        </div>

        {/* Language Servers List */}
        <div className="p-2">
          {hasActiveServers ? (
            <div className="space-y-1">
              <div className="px-1 pb-1 text-[10px] text-text-lighter uppercase tracking-wide">
                Active Language Servers
              </div>
              {activeServers.map((server) => (
                <div
                  key={server}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover"
                >
                  <Zap size={10} className="text-green-400" />
                  <span className="text-text text-xs capitalize">{server}</span>
                </div>
              ))}
            </div>
          ) : lspStatus.status === "connecting" ? (
            <div className="flex items-center gap-2 px-2 py-2 text-text-lighter">
              <Loader2 size={12} className="animate-spin text-yellow-400" />
              <span className="text-xs">Connecting...</span>
            </div>
          ) : lspStatus.status === "error" ? (
            <div className="space-y-2 p-1">
              <div className="flex items-center gap-2 text-red-400">
                <ZapOff size={12} />
                <span className="text-xs">Connection Error</span>
              </div>
              {lspStatus.lastError && (
                <div className="rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] text-red-400">
                  {lspStatus.lastError}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2 py-2 text-text-lighter">
              <ZapOff size={12} className="opacity-50" />
              <span className="text-xs">No active language servers</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border border-transparent p-0 transition-colors",
          config.color,
          config.bgHover,
        )}
        style={{ minHeight: 0, minWidth: 0 }}
        title={config.title}
      >
        {config.icon}
      </button>
      {typeof document !== "undefined" && createPortal(renderDropdown(), document.body)}
    </div>
  );
};

const AiUsageStatusIndicator = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [autocompleteModels, setAutocompleteModels] = useState<AutocompleteModel[]>(
    DEFAULT_AUTOCOMPLETE_MODELS,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
  const isPro = subscriptionStatus === "pro" || subscriptionStatus === "trial";
  const aiAllowedByPolicy = managedPolicy ? managedPolicy.aiCompletionEnabled : true;
  const byokAllowedByPolicy = managedPolicy ? managedPolicy.allowByok : true;
  const planLabel = (() => {
    if (!isAuthenticated) return "Guest";
    if (subscriptionStatus === "trial") return "Trial";
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

  useOnClickOutside(dropdownRef as RefObject<HTMLElement>, (event) => {
    const target = event.target as HTMLElement;
    if (target && buttonRef.current?.contains(target)) return;
    setIsOpen(false);
  });

  useLayoutEffect(() => {
    if (isOpen && buttonRef.current && dropdownRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const dropdownWidth = dropdownRect.width;
      const dropdownHeight = dropdownRect.height;
      const padding = 8;

      let left = rect.right - dropdownWidth;
      let top = rect.top - dropdownHeight - padding;

      if (left < padding) left = padding;
      if (left + dropdownWidth > window.innerWidth - padding) {
        left = window.innerWidth - dropdownWidth - padding;
      }
      if (top < padding) top = rect.bottom + padding;

      setPosition({ top, left });
    }
  }, [isOpen]);

  const renderDropdown = () => {
    if (!isOpen) return null;

    return (
      <div
        ref={dropdownRef}
        className="fixed z-[10030] flex w-[320px] flex-col overflow-hidden rounded-2xl border border-border bg-primary-bg/95 backdrop-blur-sm"
        style={{ top: position.top, left: position.left }}
      >
        <div className="flex items-center justify-between border-border/70 border-b bg-secondary-bg/75 px-3 py-2.5">
          <span className="font-medium text-text text-xs">AI</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                void refreshAll();
              }}
              className="ui-font rounded-md px-1.5 py-1 text-[10px] text-text-lighter hover:bg-hover hover:text-text"
            >
              Refresh
            </button>
            <button
              onClick={() => {
                setIsOpen(false);
                uiState.openSettingsDialog("ai");
              }}
              className="ui-font rounded-md px-1.5 py-1 text-[10px] text-text-lighter hover:bg-hover hover:text-text"
            >
              AI Settings
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-md p-1 text-text-lighter hover:bg-hover hover:text-text"
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
              className="ui-font mt-2 flex w-full items-center justify-center rounded-lg border border-accent bg-accent px-2 py-1.5 text-white text-xs hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
              <select
                id="footer-ai-model-select"
                value={aiAutocompleteModelId}
                onChange={(e) => updateSetting("aiAutocompleteModelId", e.target.value)}
                disabled={isLoadingModels}
                className="ui-font w-full rounded-lg border border-border bg-secondary-bg px-2 py-1.5 text-text text-xs outline-none focus:border-accent disabled:opacity-60"
              >
                {autocompleteModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "ui-font flex items-center gap-1 rounded-full px-2 py-1 font-medium text-xs hover:bg-hover",
          modeToneClass,
        )}
        style={{ minHeight: 0, minWidth: 0 }}
        title={`${planLabel} • ${modeLabel}`}
      >
        <span className="ui-font text-[11px]">{indicatorLabel}</span>
      </button>
      {typeof document !== "undefined" && createPortal(renderDropdown(), document.body)}
    </div>
  );
};

const EditorFooter = () => {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const settings = useSettingsStore((state) => state.settings);
  const uiState = useUIState();
  const { rootFolderPath } = useFileSystemStore();
  const { gitStatus, actions } = useGitStore();
  const { available, downloading, installing, updateInfo, downloadAndInstall } = useUpdater(false);
  const cursorPosition = useEditorStateStore.use.cursorPosition();

  // Get diagnostics count for badge display
  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnosticsCount = Array.from(diagnosticsByFile.values()).reduce(
    (total, diagnostics) => total + diagnostics.length,
    0,
  );
  const footerPillClass =
    "flex h-6 items-center gap-0.5 rounded-full border border-transparent px-2 text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text";
  const footerActiveClass = "border-border bg-selected text-text";

  return (
    <div className="relative z-20 flex min-h-9 shrink-0 items-center justify-between bg-secondary-bg/70 px-2.5 py-1 backdrop-blur-sm">
      <div className="ui-font flex items-center gap-1 text-text-lighter text-xs">
        {/* Git branch manager */}
        {rootFolderPath && gitStatus?.branch && (
          <GitBranchManager
            currentBranch={gitStatus.branch}
            repoPath={rootFolderPath}
            paletteTarget
            placement="up"
            onBranchChange={async () => {
              const status = await getGitStatus(rootFolderPath);
              actions.setGitStatus(status);
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

              // Request terminal focus after showing
              if (showingTerminal) {
                setTimeout(() => {
                  uiState.requestTerminalFocus();
                }, 100);
              }
            }}
            className={cn(
              footerPillClass,
              uiState.isBottomPaneVisible &&
                uiState.bottomPaneActiveTab === "terminal" &&
                footerActiveClass,
            )}
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
              footerPillClass,
              uiState.isBottomPaneVisible &&
                uiState.bottomPaneActiveTab === "diagnostics" &&
                footerActiveClass,
              !(uiState.isBottomPaneVisible && uiState.bottomPaneActiveTab === "diagnostics") &&
                diagnosticsCount > 0 &&
                "text-warning",
            )}
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

        {/* LSP Status indicator */}
        <LspStatusIndicator
          projectName={rootFolderPath ? getFilenameFromPath(rootFolderPath) : null}
        />

        {/* Vim status indicator */}
        <VimStatusIndicator />

        {/* Update indicator */}
        {available && (
          <button
            onClick={downloadAndInstall}
            disabled={downloading || installing}
            className={cn(
              footerPillClass,
              downloading || installing
                ? "cursor-not-allowed border-transparent text-text-lighter"
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
        {/* Cursor position */}
        {activeBuffer && (
          <span className="mr-1 text-[10px]">
            Ln {cursorPosition.line + 1}, Col {cursorPosition.column + 1}
          </span>
        )}

        {isAuthenticated && <AiUsageStatusIndicator />}

        {/* AI Chat button */}
        <button
          onClick={() => {
            useSettingsStore.getState().toggleAIChatVisible();
          }}
          className={cn(
            "flex h-6 items-center justify-center rounded-full border border-transparent px-2 transition-colors",
            settings.isAIChatVisible
              ? "border-border bg-selected text-text"
              : "text-text-lighter hover:border-border/70 hover:bg-hover hover:text-text",
          )}
          style={{ minHeight: 0, minWidth: 0 }}
          title="Toggle AI Chat"
        >
          <Sparkles size={12} />
        </button>

        {/* Settings button */}
        <button
          onClick={() => uiState.setIsSettingsDialogVisible(true)}
          className="flex h-6 items-center justify-center rounded-full border border-transparent px-2 text-text-lighter transition-colors hover:border-border/70 hover:bg-hover hover:text-text"
          style={{ minHeight: 0, minWidth: 0 }}
          title="Settings"
        >
          <Settings size={12} />
        </button>
      </div>
    </div>
  );
};

export default EditorFooter;
