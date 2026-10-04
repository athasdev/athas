import { KeyIcon, TrashIcon } from "@/ui/icons";
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
import Section, { SettingRow, SettingStatus } from "../settings-section";

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
        control="select"
        onReset={() => updateSetting("githubTokenSource", getDefaultSetting("githubTokenSource"))}
        canReset={tokenSource !== getDefaultSetting("githubTokenSource")}
      >
        <Select
          value={tokenSource}
          options={TOKEN_SOURCE_OPTIONS}
          onChange={(value) => updateSetting("githubTokenSource", value as TokenSourceSetting)}
          variant="surface"
          width="full"
        />
      </SettingRow>

      <SettingRow
        label="Active Credential"
        description={
          isLoadingStatus ? undefined : statusError ? (
            <SettingStatus tone="danger">{statusError}</SettingStatus>
          ) : status?.source && status.login ? (
            status.login
          ) : status?.source ? (
            "GitHub rejected the resolved token"
          ) : (
            "No GitHub credential available"
          )
        }
        activateOnClick={false}
      >
        <div className="flex items-center gap-2">
          {isLoadingStatus ? (
            <Spinner label="Checking credential" compact />
          ) : status?.source && status.login ? (
            <Badge>{GITHUB_TOKEN_SOURCE_LABELS[status.source]}</Badge>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void loadStatus()}>
            Refresh
          </Button>
        </div>
      </SettingRow>

      {destructiveScopes.length > 0 && (
        <SettingRow
          label="Token Permissions"
          description={<SettingStatus tone="warning">{destructiveScopes.join(", ")}</SettingStatus>}
          activateOnClick={false}
        >
          {null}
        </SettingRow>
      )}

      <SettingRow
        label="Personal Access Token"
        description="Needs the repo scope"
        control="field"
        activateOnClick={false}
      >
        <Input
          type="password"
          grow
          value={patInput}
          onChange={(e) => setPatInput(e.target.value)}
          placeholder={status?.hasPersonalAccessToken ? "••••••••  (saved)" : "ghp_…"}
          spellCheck={false}
          leftIcon={KeyIcon}
          autoComplete="off"
          aria-label="GitHub personal access token"
          disabled={isSavingPat}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleSavePat()}
          disabled={!patInput.trim() || isSavingPat}
        >
          {isSavingPat ? "Saving…" : "Save"}
        </Button>
        {status?.hasPersonalAccessToken && (
          <Button
            type="button"
            variant="ghost"
            tone="danger"
            onClick={() => void handleRemovePat()}
            tooltip="Remove saved personal access token"
            aria-label="Remove saved personal access token"
            iconOnly
          >
            <TrashIcon />
          </Button>
        )}
      </SettingRow>

      <SettingRow
        label="GitHub CLI"
        description={status?.ghCliInstalled ? "gh detected" : "gh not found on this machine"}
        activateOnClick={false}
      >
        {status?.ghCliInstalled ? (
          <Button type="button" variant="outline" onClick={() => void handleRefreshGhCli()}>
            Re-read token
          </Button>
        ) : null}
      </SettingRow>
    </Section>
  );
};
