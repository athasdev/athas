import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertCircle, ExternalLink, KeyRound, Package, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HarnessRuntimeBackend } from "@/features/ai/lib/harness-runtime-backend";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useToast } from "@/features/layout/contexts/toast-context";
import {
  clearPiAuthCredential,
  getPiEffectiveProviderId,
  getPiScopedDefaults,
  getPiSettingsSnapshot,
  installPiPackage,
  loginPiProvider,
  logoutPiProvider,
  type PiNativeSettingsEvent,
  type PiProviderState,
  type PiSettingsScope,
  type PiSettingsSnapshot,
  removePiPackage,
  respondPiNativeAuthPrompt,
  setPiApiKeyCredential,
  setPiScopedDefaults,
} from "@/features/settings/lib/pi-settings";
import {
  reloadActivePiNativeSessionsForWorkspace,
  subscribePiSettingsAutoRefresh,
} from "@/features/settings/lib/pi-settings-runtime";
import { useSettingsStore } from "@/features/settings/store";
import { useProjectStore } from "@/stores/project-store";
import Button from "@/ui/button";
import Dropdown from "@/ui/dropdown";
import Section, { SettingRow } from "@/ui/section";

interface AgentConfig {
  id: string;
  installed: boolean;
}

function getAuthStatusLabel(provider: PiProviderState) {
  switch (provider.authStatus) {
    case "oauth":
      return "Signed in with OAuth";
    case "api_key":
      return "Stored API key";
    case "environment":
      return "Environment key";
    default:
      return "Not configured";
  }
}

function getDefaultSourceLabel(
  snapshot: PiSettingsSnapshot,
  scope: PiSettingsScope,
  key: keyof PiSettingsSnapshot["defaults"]["effective"],
) {
  const scoped = getPiScopedDefaults(snapshot, scope);
  if (scope === "project" && scoped[key]) {
    return "Project";
  }
  if (snapshot.defaults.global[key]) {
    return "Global";
  }
  return "Unset";
}

function getProviderOptions(snapshot: PiSettingsSnapshot, scope: PiSettingsScope) {
  const placeholder = scope === "project" ? "Inherit from Global" : "Not set";
  return [
    { value: "", label: placeholder },
    ...snapshot.providers
      .filter((provider) => provider.modelCount > 0)
      .map((provider) => ({
        value: provider.id,
        label: provider.name,
      })),
  ];
}

export function PiSettingsPanel() {
  const { settings, updateSetting } = useSettingsStore();
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const { showToast } = useToast();

  const [scope, setScope] = useState<PiSettingsScope>("global");
  const [snapshot, setSnapshot] = useState<PiSettingsSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [legacyPiInstalled, setLegacyPiInstalled] = useState<boolean | null>(null);
  const [packageSource, setPackageSource] = useState("");
  const [packageBusy, setPackageBusy] = useState(false);
  const [authBusyProviderId, setAuthBusyProviderId] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  const workspacePath = rootFolderPath ?? null;

  const loadSnapshot = useCallback(async () => {
    setLoadingSnapshot(true);
    setSnapshotError(null);
    try {
      const nextSnapshot = await getPiSettingsSnapshot(workspacePath);
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load Pi settings";
      setSnapshotError(message);
      throw error;
    } finally {
      setLoadingSnapshot(false);
    }
  }, [workspacePath]);

  const loadLegacyHealth = useCallback(async () => {
    try {
      const agents = await invoke<AgentConfig[]>("get_available_agents");
      setLegacyPiInstalled(agents.find((agent) => agent.id === "pi")?.installed ?? false);
    } catch {
      setLegacyPiInstalled(null);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot().catch(() => {});
    void loadLegacyHealth();
  }, [loadSnapshot, loadLegacyHealth]);

  useEffect(() => {
    return subscribePiSettingsAutoRefresh(() => {
      void loadSnapshot().catch(() => {});
    });
  }, [loadSnapshot]);

  useEffect(() => {
    if (scope === "project" && !rootFolderPath) {
      setScope("global");
    }
  }, [rootFolderPath, scope]);

  useEffect(() => {
    const unlistenPromise = listen<PiNativeSettingsEvent>(
      "pi-native-settings-event",
      async (event) => {
        const payload = event.payload;

        if (payload.type === "auth_start") {
          setAuthBusyProviderId(payload.providerId);
          setAuthMessage(`Starting ${payload.providerId} sign-in...`);
          return;
        }

        if (payload.type === "auth_open_url") {
          setAuthMessage(payload.instructions ?? "Complete sign-in in your browser.");
          await openUrl(payload.url);
          return;
        }

        if (payload.type === "auth_progress") {
          setAuthMessage(payload.message);
          return;
        }

        if (payload.type === "auth_prompt") {
          const value = window.prompt(payload.message, payload.placeholder ?? "");
          await respondPiNativeAuthPrompt({
            requestId: payload.requestId,
            value,
            cancelled: value === null,
          });
          return;
        }

        if (payload.type === "auth_complete") {
          setAuthBusyProviderId(null);
          setAuthMessage(null);
          return;
        }

        if (payload.type === "auth_error") {
          setAuthBusyProviderId(null);
          setAuthMessage(payload.error);
        }
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [showToast]);

  const authProviders = useMemo(() => {
    return (
      snapshot?.providers.filter((provider) => {
        return (
          provider.supportsOAuth ||
          provider.supportsApiKey ||
          provider.hasStoredAuth ||
          provider.hasEnvironmentAuth
        );
      }) ?? []
    );
  }, [snapshot]);

  const packageEntries = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    return scope === "project" ? snapshot.packages.project : snapshot.packages.global;
  }, [scope, snapshot]);

  const scopedDefaults = snapshot ? getPiScopedDefaults(snapshot, scope) : null;
  const selectedProviderId = snapshot ? getPiEffectiveProviderId(snapshot, scope) : "";
  const selectedProvider =
    snapshot?.providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const modelOptions = [
    {
      value: "",
      label: scope === "project" ? "Inherit from Global" : "Not set",
    },
    ...(selectedProvider?.models.map((model) => ({
      value: model.modelId,
      label: model.name,
    })) ?? []),
  ];

  const setSnapshotAndToast = (nextSnapshot: PiSettingsSnapshot, message: string) => {
    setSnapshot(nextSnapshot);
    showToast({ message, type: "success" });
  };

  const handleDefaultProviderChange = async (providerId: string) => {
    if (!snapshot) {
      return;
    }

    const provider = snapshot.providers.find((candidate) => candidate.id === providerId) ?? null;
    const currentModel = scopedDefaults?.defaultModel ?? snapshot.defaults.effective.defaultModel;
    const nextModel =
      providerId === ""
        ? null
        : provider?.models.some((model) => model.modelId === currentModel)
          ? currentModel
          : (provider?.models[0]?.modelId ?? null);

    const nextSnapshot = await setPiScopedDefaults({
      workspacePath,
      scope,
      defaultProvider: providerId || null,
      defaultModel: nextModel,
    });
    setSnapshotAndToast(
      nextSnapshot,
      `${scope === "project" ? "Project" : "Global"} provider updated`,
    );
  };

  const handleDefaultModelChange = async (modelId: string) => {
    const nextSnapshot = await setPiScopedDefaults({
      workspacePath,
      scope,
      defaultModel: modelId || null,
    });
    setSnapshotAndToast(
      nextSnapshot,
      `${scope === "project" ? "Project" : "Global"} model updated`,
    );
  };

  const handleThinkingChange = async (thinkingLevel: string) => {
    const nextSnapshot = await setPiScopedDefaults({
      workspacePath,
      scope,
      defaultThinkingLevel: thinkingLevel || null,
    });
    setSnapshotAndToast(
      nextSnapshot,
      `${scope === "project" ? "Project" : "Global"} thinking updated`,
    );
  };

  const handleLogin = async (providerId: string) => {
    setAuthBusyProviderId(providerId);
    try {
      const nextSnapshot = await loginPiProvider({ workspacePath, providerId });
      setSnapshotAndToast(nextSnapshot, `${providerId} connected`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to log into ${providerId}`;
      setAuthBusyProviderId(null);
      setAuthMessage(message);
      showToast({ message, type: "error" });
    }
  };

  const handleLogout = async (providerId: string) => {
    try {
      const nextSnapshot = await logoutPiProvider({ workspacePath, providerId });
      setSnapshotAndToast(nextSnapshot, `${providerId} logged out`);
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : `Failed to log out of ${providerId}`,
        type: "error",
      });
    }
  };

  const handleSaveApiKey = async (providerId: string) => {
    const key = apiKeys[providerId]?.trim();
    if (!key) {
      showToast({ message: "Enter an API key first", type: "error" });
      return;
    }

    try {
      const nextSnapshot = await setPiApiKeyCredential({ workspacePath, providerId, key });
      setApiKeys((current) => ({ ...current, [providerId]: "" }));
      setSnapshotAndToast(nextSnapshot, `${providerId} API key saved`);
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : `Failed to save ${providerId} API key`,
        type: "error",
      });
    }
  };

  const handleClearAuth = async (providerId: string) => {
    try {
      const nextSnapshot = await clearPiAuthCredential({ workspacePath, providerId });
      setSnapshotAndToast(nextSnapshot, `${providerId} credentials cleared`);
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : `Failed to clear ${providerId} auth`,
        type: "error",
      });
    }
  };

  const handleInstallPackage = async () => {
    const source = packageSource.trim();
    if (!source) {
      showToast({ message: "Enter a package source first", type: "error" });
      return;
    }

    setPackageBusy(true);
    try {
      const nextSnapshot = await installPiPackage({ workspacePath, scope, source });
      setPackageSource("");
      setSnapshotAndToast(nextSnapshot, `Installed ${source}`);
      try {
        await reloadActivePiNativeSessionsForWorkspace(workspacePath);
      } catch (error) {
        showToast({
          message:
            error instanceof Error
              ? `Installed ${source}, but active Pi sessions did not reload: ${error.message}`
              : `Installed ${source}, but active Pi sessions did not reload`,
          type: "warning",
        });
      }
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : `Failed to install ${source}`,
        type: "error",
      });
    } finally {
      setPackageBusy(false);
    }
  };

  const handleRemovePackage = async (source: string) => {
    setPackageBusy(true);
    try {
      const nextSnapshot = await removePiPackage({ workspacePath, scope, source });
      setSnapshotAndToast(nextSnapshot, `Removed ${source}`);
      try {
        await reloadActivePiNativeSessionsForWorkspace(workspacePath);
      } catch (error) {
        showToast({
          message:
            error instanceof Error
              ? `Removed ${source}, but active Pi sessions did not reload: ${error.message}`
              : `Removed ${source}, but active Pi sessions did not reload`,
          type: "warning",
        });
      }
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : `Failed to remove ${source}`,
        type: "error",
      });
    } finally {
      setPackageBusy(false);
    }
  };

  const visibleResources = useMemo(() => {
    return (snapshot?.resources ?? []).filter((resource) => {
      return scope === "project" ? resource.scope === "project" : resource.scope === "user";
    });
  }, [scope, snapshot]);

  return (
    <>
      <Section title="Pi Runtime">
        <SettingRow
          label="Harness Backend"
          description="Choose whether Pi opens in the native runtime or the legacy ACP bridge"
        >
          <Dropdown
            value={settings.aiPiHarnessBackend}
            options={[
              { value: "pi-native", label: "Pi Native" },
              { value: "legacy-acp-bridge", label: "Legacy ACP Bridge" },
            ]}
            onChange={(value) =>
              updateSetting("aiPiHarnessBackend", value as HarnessRuntimeBackend)
            }
            size="xs"
          />
        </SettingRow>
        <div className="grid gap-2 px-1 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-secondary-bg px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text text-xs">Pi Native</span>
              <span className="text-green-400 text-xs">
                {snapshot ? "Ready" : loadingSnapshot ? "Loading" : "Unavailable"}
              </span>
            </div>
            <div className="mt-1 text-text-lighter text-xs">
              {snapshot ? snapshot.agentDir : "Shared Pi state is not reachable yet."}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-secondary-bg px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text text-xs">Legacy ACP Bridge</span>
              <span
                className={
                  legacyPiInstalled === false ? "text-red-400 text-xs" : "text-text-lighter text-xs"
                }
              >
                {legacyPiInstalled === null
                  ? "Unknown"
                  : legacyPiInstalled
                    ? "Installed"
                    : "Pi binary missing"}
              </span>
            </div>
            <div className="mt-1 text-text-lighter text-xs">
              Keeps the old external Pi bridge available for fallback and diagnostics.
            </div>
          </div>
        </div>
        {snapshotError && (
          <div className="flex items-center gap-1.5 px-1 text-red-400 text-xs">
            <AlertCircle size={12} />
            <span>{snapshotError}</span>
          </div>
        )}
      </Section>

      <Section title="Pi Defaults">
        <div className="flex items-center gap-2 px-1">
          <Button
            variant="outline"
            size="xs"
            active={scope === "global"}
            onClick={() => setScope("global")}
          >
            Global
          </Button>
          <Button
            variant="outline"
            size="xs"
            active={scope === "project"}
            onClick={() => setScope("project")}
            disabled={!rootFolderPath}
          >
            Project
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void loadSnapshot().catch(() => {})}
            disabled={loadingSnapshot}
          >
            <RefreshCw size={12} className={loadingSnapshot ? "animate-spin" : ""} />
          </Button>
        </div>
        {snapshot && scopedDefaults && (
          <>
            <SettingRow
              label="Default Provider"
              description={`Current source: ${getDefaultSourceLabel(snapshot, scope, "defaultProvider")}`}
            >
              <Dropdown
                value={scopedDefaults.defaultProvider ?? ""}
                options={getProviderOptions(snapshot, scope)}
                onChange={(value) => void handleDefaultProviderChange(value)}
                size="xs"
                searchable={true}
                className="w-56"
              />
            </SettingRow>
            <SettingRow
              label="Default Model"
              description={`Current source: ${getDefaultSourceLabel(snapshot, scope, "defaultModel")}`}
            >
              <Dropdown
                value={scopedDefaults.defaultModel ?? ""}
                options={modelOptions}
                onChange={(value) => void handleDefaultModelChange(value)}
                size="xs"
                searchable={true}
                className="w-56"
              />
            </SettingRow>
            <SettingRow
              label="Thinking Level"
              description={`Current source: ${getDefaultSourceLabel(snapshot, scope, "defaultThinkingLevel")}`}
            >
              <Dropdown
                value={scopedDefaults.defaultThinkingLevel ?? ""}
                options={[
                  { value: "", label: scope === "project" ? "Inherit from Global" : "Not set" },
                  ...snapshot.thinkingLevels.map((level) => ({
                    value: level,
                    label: level,
                  })),
                ]}
                onChange={(value) => void handleThinkingChange(value)}
                size="xs"
              />
            </SettingRow>
          </>
        )}
      </Section>

      <Section title="Provider Auth">
        {authMessage && <div className="px-1 text-text-lighter text-xs">{authMessage}</div>}
        {authProviders.length === 0 && (
          <div className="px-1 text-text-lighter text-xs">No Pi providers were discovered yet.</div>
        )}
        {authProviders.map((provider) => (
          <div
            key={provider.id}
            className="rounded-lg border border-border bg-secondary-bg px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-text text-xs">{provider.name}</div>
                <div className="text-text-lighter text-xs">{getAuthStatusLabel(provider)}</div>
              </div>
              <div className="text-right text-text-lighter text-xs">
                {provider.hasEnvironmentAuth ? "Environment auth present" : "Shared auth.json"}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {provider.supportsOAuth && (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => void handleLogin(provider.id)}
                    disabled={authBusyProviderId === provider.id}
                  >
                    {authBusyProviderId === provider.id ? "Signing in..." : "Sign In"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void handleLogout(provider.id)}
                    disabled={!provider.hasStoredAuth}
                  >
                    Logout
                  </Button>
                </>
              )}
              {provider.supportsApiKey && (
                <>
                  <div className="flex items-center gap-1 rounded-md border border-border bg-primary-bg px-2 py-1">
                    <KeyRound size={12} className="text-text-lighter" />
                    <input
                      type="password"
                      value={apiKeys[provider.id] ?? ""}
                      onChange={(event) =>
                        setApiKeys((current) => ({ ...current, [provider.id]: event.target.value }))
                      }
                      placeholder={
                        provider.hasStoredAuth
                          ? "Stored in auth.json. Paste to replace."
                          : "Paste API key"
                      }
                      className="w-52 bg-transparent text-text text-xs outline-none placeholder:text-text-lighter"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => void handleSaveApiKey(provider.id)}
                  >
                    Save Key
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void handleClearAuth(provider.id)}
                    disabled={!provider.hasStoredAuth}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Packages & Resources">
        <div className="flex items-center gap-2 px-1">
          <input
            type="text"
            value={packageSource}
            onChange={(event) => setPackageSource(event.target.value)}
            placeholder={
              scope === "project"
                ? "Project package source or local path"
                : "Global package source or local path"
            }
            className="w-full rounded-lg border border-border bg-secondary-bg px-2 py-1.5 text-text text-xs focus:border-accent focus:outline-none"
          />
          <Button
            variant="outline"
            size="xs"
            onClick={() => void handleInstallPackage()}
            disabled={packageBusy}
          >
            {packageBusy ? "Working..." : "Install"}
          </Button>
        </div>
        <div className="space-y-2 px-1">
          {packageEntries.length === 0 ? (
            <div className="text-text-lighter text-xs">No {scope} Pi packages configured yet.</div>
          ) : (
            packageEntries.map((entry) => (
              <div
                key={`${entry.scope}:${entry.source}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary-bg px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium text-text text-xs">
                    <Package size={12} />
                    <span className="truncate">{entry.source}</span>
                  </div>
                  <div className="text-text-lighter text-xs">
                    {entry.installedPath ?? `${entry.scope} package source`}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleRemovePackage(entry.source)}
                  disabled={packageBusy}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
        <div className="space-y-2 px-1">
          <div className="font-medium text-text text-xs">Discovered Resources</div>
          {visibleResources.length === 0 ? (
            <div className="text-text-lighter text-xs">No {scope} resources discovered yet.</div>
          ) : (
            visibleResources.map((resource) => (
              <div
                key={resource.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary-bg px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-medium text-text text-xs">{resource.name}</div>
                  <div className="truncate text-text-lighter text-xs">
                    {resource.kind} from {resource.origin} · {resource.source}
                  </div>
                </div>
                <span
                  className={
                    resource.enabled ? "text-green-400 text-xs" : "text-text-lighter text-xs"
                  }
                >
                  {resource.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section title="Advanced Files">
        <div className="space-y-2 px-1">
          {snapshot?.files.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary-bg px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-medium text-text text-xs">{file.label}</div>
                <div className="truncate text-text-lighter text-xs">{file.path}</div>
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => handleFileSelect?.(file.path, false)}
                disabled={!file.exists || !handleFileSelect}
              >
                <ExternalLink size={12} />
              </Button>
            </div>
          ))}
          {!snapshot && (
            <div className="text-text-lighter text-xs">
              Pi config files will appear after the first successful load.
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
