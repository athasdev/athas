import { KeyIcon, TrashIcon, WarningCircleIcon } from "@/ui/icons";
import { useCallback, useEffect, useState } from "react";
import {
  GITHUB_TOKEN_SOURCE_LABELS,
  getDestructiveScopes,
  getGitHubTokenStatus,
  type GitHubTokenStatus,
  refreshGitHubGhCliToken,
  removeGitHubPersonalAccessToken,
  storeGitHubPersonalAccessToken,
} from "@/features/github/services/github-credential-service";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";
import Section, { SettingRow } from "../settings-section";

type TokenSourceSetting = "auto" | "athas" | "pat" | "gh";

const TOKEN_SOURCE_OPTIONS = [
  { value: "auto", label: "Automatic" },
  { value: "pat", label: "Personal access token" },
  { value: "athas", label: "Athas account" },
  { value: "gh", label: "GitHub CLI (gh)" },
];

export const GitHubCredentials = () => {
  const { showToast } = useToast();
  const tokenSource = useSettingsStore((state) => state.settings.githubTokenSource);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const checkAuth = useGitHubStore.use.actions().checkAuth;

  const [status, setStatus] = useState<GitHubTokenStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [patInput, setPatInput] = useState("");
  const [isSavingPat, setIsSavingPat] = useState(false);

  const loadStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      setStatus(await getGitHubTokenStatus());
      setStatusError(null);
    } catch (error) {
      setStatus(null);
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // The resolver reads the preference from settings.json, so the active source
  // can change without any token being touched.
  useEffect(() => {
    void loadStatus();
  }, [loadStatus, tokenSource]);

  const applyCredentialChange = async () => {
    await loadStatus();
    await checkAuth({ force: true });
  };

  const handleSavePat = async () => {
    const trimmed = patInput.trim();
    if (!trimmed) return;
    setIsSavingPat(true);
    try {
      await storeGitHubPersonalAccessToken(trimmed);
      setPatInput("");
      showToast({ message: "GitHub personal access token saved", type: "success" });
      await applyCredentialChange();
    } catch {
      showToast({ message: "Failed to save personal access token", type: "error" });
    } finally {
      setIsSavingPat(false);
    }
  };

  const handleRemovePat = async () => {
    try {
      await removeGitHubPersonalAccessToken();
      setPatInput("");
      showToast({ message: "GitHub personal access token removed", type: "success" });
      await applyCredentialChange();
    } catch {
      showToast({ message: "Failed to remove personal access token", type: "error" });
    }
  };

  const handleRefreshGhCli = async () => {
    try {
      await refreshGitHubGhCliToken();
      await applyCredentialChange();
    } catch {
      showToast({ message: "Failed to re-read the GitHub CLI token", type: "error" });
    }
  };

  const destructiveScopes = getDestructiveScopes(status?.scopes ?? null);

  return (
    <Section title="GitHub Account">
      <SettingRow
        label="Token Source"
        description="Which credential Athas authenticates GitHub with. Automatic prefers a personal access token, then your Athas account, then the GitHub CLI."
        onReset={() => updateSetting("githubTokenSource", getDefaultSetting("githubTokenSource"))}
        canReset={tokenSource !== getDefaultSetting("githubTokenSource")}
      >
        <Select
          value={tokenSource}
          options={TOKEN_SOURCE_OPTIONS}
          onChange={(value) => updateSetting("githubTokenSource", value as TokenSourceSetting)}
          variant="default"
        />
      </SettingRow>

      <SettingRow
        label="Active Credential"
        description="The token currently used for pull requests, issues, and Actions"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isLoadingStatus ? (
            <Spinner label="Checking credential" showLabel compact />
          ) : statusError ? (
            <span className="text-error text-xs">{statusError}</span>
          ) : status?.source && status.login ? (
            <>
              <Badge>{GITHUB_TOKEN_SOURCE_LABELS[status.source]}</Badge>
              <span className="text-subtle-foreground text-xs">{status.login}</span>
            </>
          ) : (
            <span className="text-subtle-foreground text-xs">
              {status?.source
                ? "GitHub rejected the resolved token"
                : "No GitHub credential available"}
            </span>
          )}
          <Button type="button" variant="ghost" onClick={() => void loadStatus()}>
            Refresh
          </Button>
        </div>
      </SettingRow>

      {destructiveScopes.length > 0 && (
        <SettingRow
          label="Token Permissions"
          description="This token can perform destructive actions on your account. Consider a narrower token for Athas."
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <WarningCircleIcon className="shrink-0 text-warning" />
            <span className="text-subtle-foreground text-xs">{destructiveScopes.join(", ")}</span>
          </div>
        </SettingRow>
      )}

      <SettingRow
        label="Personal Access Token"
        description="Use your own token when an organization has not approved the Athas GitHub app. Needs the repo scope."
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex w-56 min-w-0 max-w-full">
            <Input
              type="password"
              value={patInput}
              onChange={(e) => setPatInput(e.target.value)}
              placeholder={status?.hasPersonalAccessToken ? "••••••••  (saved)" : "ghp_…"}
              spellCheck={false}
              leftIcon={KeyIcon}
              autoComplete="off"
              disabled={isSavingPat}
            />
          </span>
          <Button
            type="button"
            variant="default"
            onClick={() => void handleSavePat()}
            disabled={!patInput.trim() || isSavingPat}
          >
            {isSavingPat ? "Saving…" : "Save"}
          </Button>
          {status?.hasPersonalAccessToken && (
            <Button
              type="button"
              variant="danger"
              onClick={() => void handleRemovePat()}
              tooltip="Remove saved personal access token"
              iconOnly
            >
              <TrashIcon />
            </Button>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label="GitHub CLI"
        description="Reuses the token from your gh installation. Read on demand and never stored by Athas."
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-subtle-foreground text-xs">
            {status?.ghCliInstalled ? "gh detected" : "gh not found on this machine"}
          </span>
          {status?.ghCliInstalled && (
            <Button type="button" variant="ghost" onClick={() => void handleRefreshGhCli()}>
              Re-read token
            </Button>
          )}
        </div>
      </SettingRow>
    </Section>
  );
};
